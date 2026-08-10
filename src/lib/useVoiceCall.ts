import { useRef, useState, useCallback, useEffect } from "react";
import {
  RealtimeClient,
  type AddPartialTranscript,
  type AddTranscript,
  type ErrorType,
  type ReceiveMessageEvent,
  type SocketStateChangeEvent,
} from "@speechmatics/real-time-client";
import { fetchSpeechmaticsToken, fetchSpeechmaticsTTS, type SybilError } from "./sybil";
import type { SybilState } from "../config/tokens";

interface VoiceCallResult {
  /** idle (not started) | listening | thinking (turn handed off) | speaking (TTS playing). */
  state: SybilState;
  /** Live transcript of the utterance currently being spoken (partial + finalised so far). */
  liveTranscript: string;
  /** Set once on a fatal error (socket drop, expired token, mic denied); the call has already closed itself. */
  callError: string | null;
  /** Opens the mic and starts listening. */
  start: () => Promise<void>;
  /** Closes everything: mic, AudioContext, TTS playback, websocket. */
  stop: () => void;
  /** Manual "I'm done talking" — skips waiting for the silence timer. */
  endTurnNow: () => void;
  /** Speaks `text` via TTS with the mic muted, then unmutes and resumes listening. */
  speak: (text: string) => Promise<void>;
  /** Unmutes the mic and resumes listening without speaking (used on a non-fatal turn error). */
  resumeListening: () => void;
}

/**
 * React hook for a continuous, real-time voice call with Sybil: listens,
 * detects end-of-turn via Speechmatics' native silence trigger, hands the
 * finalised utterance to the caller, then plays back TTS while muted.
 *
 * Separate from useVoiceInput (dictation) — shares no state with it, though
 * both talk to the same Speechmatics infra.
 */
export function useVoiceCall(onTurn: (text: string) => void): VoiceCallResult {
  const [state, setState] = useState<SybilState>("idle");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [callError, setCallError] = useState<string | null>(null);

  const clientRef = useRef<RealtimeClient | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const partialRef = useRef("");
  const finalRef = useRef("");
  const activeRef = useRef(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  // Always read the latest onTurn without forcing callers to memoise it.
  const onTurnRef = useRef(onTurn);
  onTurnRef.current = onTurn;

  const cleanup = useCallback(() => {
    ttsAudioRef.current?.pause();
    ttsAudioRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    micTrackRef.current = null;
    clientRef.current = null;
    partialRef.current = "";
    finalRef.current = "";
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    clientRef.current?.stopRecognition({ noTimeout: true }).catch(() => {});
    cleanup();
    setState("idle");
    setLiveTranscript("");
  }, [cleanup]);

  const fail = useCallback(
    (message: string) => {
      activeRef.current = false;
      cleanup();
      setState("idle");
      setLiveTranscript("");
      setCallError(message);
    },
    [cleanup],
  );

  const resumeListening = useCallback(() => {
    if (!activeRef.current) return;
    if (micTrackRef.current) micTrackRef.current.enabled = true;
    setState("listening");
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!activeRef.current) return;
      setState("speaking");
      try {
        const blob = await fetchSpeechmaticsTTS(text);
        if (!activeRef.current) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        ttsAudioRef.current = audio;
        await new Promise<void>((resolve) => {
          audio.onended = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          audio.play().catch(() => resolve());
        });
      } catch {
        // TTS failure isn't fatal to the call — just skip playback for this turn.
      } finally {
        ttsAudioRef.current = null;
        resumeListening();
      }
    },
    [resumeListening],
  );

  const start = useCallback(async () => {
    setCallError(null);
    setLiveTranscript("");
    partialRef.current = "";
    finalRef.current = "";
    activeRef.current = true;

    try {
      const { key_value: jwt } = await fetchSpeechmaticsToken("call");

      const client = new RealtimeClient();
      clientRef.current = client;

      client.addEventListener("socketStateChange", (event: SocketStateChangeEvent) => {
        if (!activeRef.current) return;
        if (event.socketState === "closed") {
          fail("Connection lost. The call has ended.");
        }
      });

      client.addEventListener("receiveMessage", (event: ReceiveMessageEvent) => {
        if (!activeRef.current) return;
        const msg = event.data;

        if (msg.message === "Error") {
          const err = msg as ErrorType;
          fail(`Speechmatics error: ${err.reason}`);
          return;
        }

        if (msg.message === "AddPartialTranscript") {
          const partial = msg as AddPartialTranscript;
          partialRef.current = partial.results.map((r) => r.alternatives?.[0]?.content ?? "").join(" ");
          setLiveTranscript(
            finalRef.current ? `${finalRef.current} ${partialRef.current}`.trim() : partialRef.current,
          );
        }

        if (msg.message === "AddTranscript") {
          const final = msg as AddTranscript;
          const text = final.results.map((r) => r.alternatives?.[0]?.content ?? "").join(" ");
          if (text.trim()) {
            finalRef.current = finalRef.current ? `${finalRef.current} ${text.trim()}` : text.trim();
            setLiveTranscript(finalRef.current);
          }
          partialRef.current = "";
        }

        if (msg.message === "EndOfUtterance") {
          // Fall back to any un-finalised partial so a forced end-of-turn
          // still captures the last words spoken.
          const utterance = (finalRef.current || partialRef.current).trim();
          finalRef.current = "";
          partialRef.current = "";
          setLiveTranscript("");

          // Silence with nothing said — ignore, stay listening.
          if (!utterance) return;

          if (micTrackRef.current) micTrackRef.current.enabled = false;
          setState("thinking");
          onTurnRef.current(utterance);
        }
      });

      await client.start(jwt, {
        transcription_config: {
          language: "en",
          enable_partials: true,
          max_delay: 2,
          conversation_config: { end_of_utterance_silence_trigger: 0.6 },
        },
        audio_format: {
          type: "raw",
          encoding: "pcm_s16le",
          sample_rate: 16000,
        },
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;
      micTrackRef.current = stream.getAudioTracks()[0] ?? null;

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);

      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        // Muted while thinking/speaking so we never transcribe our own voice.
        if (!micTrackRef.current?.enabled) return;
        const input = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        clientRef.current?.sendAudio(pcm.buffer);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      setState("listening");
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : (err as SybilError)?.error ?? "Microphone access denied or unsupported";
      fail(message);
    }
  }, [fail]);

  const endTurnNow = useCallback(() => {
    if (!activeRef.current || state !== "listening") return;
    clientRef.current?.forceEndOfUtterance();
  }, [state]);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      clientRef.current?.stopRecognition({ noTimeout: true }).catch(() => {});
      cleanup();
    };
  }, [cleanup]);

  return { state, liveTranscript, callError, start, stop, endTurnNow, speak, resumeListening };
}
