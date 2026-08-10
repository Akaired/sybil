import { useRef, useState, useCallback, useEffect } from "react";
import {
  RealtimeClient,
  type AddPartialTranscript,
  type AddTranscript,
  type ReceiveMessageEvent,
} from "@speechmatics/real-time-client";
import { fetchSpeechmaticsToken, type SybilError } from "./sybil";

interface VoiceInputResult {
  /** Whether the microphone is currently being recorded and streamed. */
  isRecording: boolean;
  /** Start capturing audio and streaming to Speechmatics. */
  start: () => Promise<void>;
  /** Stop recording and finalise the transcript. */
  stop: () => void;
  /** Human-readable error from mic or session, or null when clean. */
  voiceError: string | null;
}

/**
 * React hook for real-time voice transcription via Speechmatics.
 *
 * @param onTranscript — called with the cumulative finalised transcript
 *   so far, each time Speechmatics finalises a new segment.
 */
export function useVoiceInput(
  onTranscript: (text: string) => void,
): VoiceInputResult {
  const [isRecording, setIsRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const clientRef = useRef<RealtimeClient | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const partialRef = useRef<string>("");
  const finalTranscriptRef = useRef<string>("");

  /** Clean up all resources. */
  const cleanup = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    clientRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setVoiceError(null);
    partialRef.current = "";
    finalTranscriptRef.current = "";

    try {
      // 1 — Get a short-lived JWT from the edge function
      const { key_value: jwt } = await fetchSpeechmaticsToken();

      // 2 — Create the real-time client (defaults to eu2 endpoint)
      const client = new RealtimeClient();
      clientRef.current = client;

      // 3 — Wire up transcript events via the receiveMessage event
      client.addEventListener("receiveMessage", (event: ReceiveMessageEvent) => {
        const msg = event.data;

        if (msg.message === "AddPartialTranscript") {
          const partial = msg as AddPartialTranscript;
          partialRef.current = partial.results
            .map((r) => r.alternatives?.[0]?.content ?? "")
            .join(" ");
        }

        if (msg.message === "AddTranscript") {
          const final = msg as AddTranscript;
          const text = final.results
            .map((r) => r.alternatives?.[0]?.content ?? "")
            .join(" ");
          if (text.trim()) {
            finalTranscriptRef.current = finalTranscriptRef.current
              ? `${finalTranscriptRef.current} ${text.trim()}`
              : text.trim();
            onTranscript(finalTranscriptRef.current);
          }
          partialRef.current = "";
        }
      });

      // 4 — Start the session
      await client.start(jwt, {
        transcription_config: {
          language: "en",
          enable_partials: true,
          max_delay: 2,
        },
        audio_format: {
          type: "raw",
          encoding: "pcm_s16le",
          sample_rate: 16000,
        },
      });

      // 5 — Open the microphone
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);

      // ScriptProcessorNode for raw PCM access (deprecated but widely supported;
      // AudioWorklet would be ideal but adds complexity for initial impl)
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        // Convert Float32 [-1,1] to Int16 PCM
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        clientRef.current?.sendAudio(pcm.buffer);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      setIsRecording(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : (err as SybilError)?.error ?? "Microphone access denied or unsupported";
      setVoiceError(message);
      cleanup();
    }
  }, [onTranscript, cleanup]);

  const stop = useCallback(() => {
    setIsRecording(false);

    // Flush any partial transcript before stopping
    if (partialRef.current.trim()) {
      finalTranscriptRef.current = finalTranscriptRef.current
        ? `${finalTranscriptRef.current} ${partialRef.current.trim()}`
        : partialRef.current.trim();
      onTranscript(finalTranscriptRef.current);
      partialRef.current = "";
    }

    // Stop recognition gracefully
    clientRef.current
      ?.stopRecognition({ noTimeout: true })
      .catch(() => {})
      .finally(() => cleanup());
  }, [onTranscript, cleanup]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      clientRef.current?.stopRecognition({ noTimeout: true }).catch(() => {});
      cleanup();
    };
  }, [cleanup]);

  return { isRecording, start, stop, voiceError };
}
