import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "../config/supabase";

const BUCKET = "ambient-music";
const VOLUME_KEY = "sybil:music-volume";
const ENABLED_KEY = "sybil:music-enabled";
const DUCK_TWEEN_MS = 400;

// ── Cross-tab playback ownership ────────────────────────────
// Only one open Sybil tab should ever emit audio. Tabs coordinate through a
// localStorage "lock" (read/written synchronously, so cheap to poll) plus
// the native `storage` event other tabs receive the instant it changes.
// A heartbeat keeps the lock fresh so a crashed/killed tab's stale lock is
// reclaimed automatically instead of silencing music forever.
const OWNER_KEY = "sybil:music-owner";
const HEARTBEAT_MS = 1500;
const OWNER_STALE_MS = 4000;
const STALE_CHECK_MS = 2000;
const CLAIM_CONFIRM_MS = 200;

type OwnerRecord = { id: string; ts: number };

function generateInstanceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readOwner(): OwnerRecord | null {
  try {
    const raw = localStorage.getItem(OWNER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.id === "string" && typeof parsed?.ts === "number") return parsed;
  } catch {
    // Corrupt value — treat as no owner.
  }
  return null;
}

function ownerIsActive(owner: OwnerRecord | null): owner is OwnerRecord {
  return !!owner && Date.now() - owner.ts < OWNER_STALE_MS;
}

function trackLabel(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function shuffled<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** A fresh shuffled pass over every track, never starting with `avoid`. */
function nextPass(names: string[], avoid: string | undefined): string[] {
  const pass = shuffled(names);
  if (avoid && pass.length > 1 && pass[0] === avoid) {
    [pass[0], pass[1]] = [pass[1], pass[0]];
  }
  return pass;
}

export type MusicTrack = { name: string; label: string };

type MusicPlayerState = {
  ready: boolean;
  hasTracks: boolean;
  isPlaying: boolean;
  volume: number;
  currentTrackLabel: string | null;
  /** Full playlist, in bucket order (not playback/shuffle order). */
  tracks: MusicTrack[];
  toggle: () => void;
  setVolume: (v: number) => void;
  skipNext: () => void;
  skipPrevious: () => void;
  /** Jump straight to a specific track by its storage file name. */
  playTrack: (name: string) => void;
  /** Temporarily tween the audible volume to `level` (0-1), independent of
   * the user's chosen volume — used to duck music during a Sybil voice
   * call. Pass null to tween back to the user's chosen volume. */
  duckTo: (level: number | null) => void;
};

const MusicPlayerContext = createContext<MusicPlayerState | null>(null);

export function useMusicPlayer(): MusicPlayerState {
  const ctx = useContext(MusicPlayerContext);
  if (!ctx) throw new Error("useMusicPlayer must be used within MusicPlayerProvider");
  return ctx;
}

/**
 * Mounted around the authenticated app (protected routes only) so playback
 * survives client-side navigation between workspace pages, but never plays
 * on the public marketing site. Two <audio> elements are swapped back and
 * forth so the next track is already loaded and ready by the time the
 * current one ends — no fetch-triggered gap between songs.
 */
export function MusicPlayerProvider({ children }: { children: ReactNode }) {
  const [trackNames, setTrackNames] = useState<string[] | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrackLabel, setCurrentTrackLabel] = useState<string | null>(null);
  const [volume, setVolumeState] = useState(() => {
    const stored = localStorage.getItem(VOLUME_KEY);
    const n = stored !== null ? parseFloat(stored) : NaN;
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
  });

  const audioRefs = useRef<[HTMLAudioElement | null, HTMLAudioElement | null]>([null, null]);
  const activeRef = useRef<0 | 1>(0);
  const queueRef = useRef<string[]>([]);
  const historyRef = useRef<string[]>([]);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  // Non-null while a duck (e.g. an active voice call) is overriding the
  // user's chosen volume; null means "play at the user's chosen volume".
  const duckLevelRef = useRef<number | null>(null);
  const duckRafRef = useRef<number | null>(null);

  const effectiveVolume = useCallback(() => duckLevelRef.current ?? volumeRef.current, []);

  const applyVolume = useCallback((el: HTMLAudioElement | null) => {
    if (el) el.volume = effectiveVolume();
  }, [effectiveVolume]);

  // ── Cross-tab ownership ──────────────────────────────────
  const instanceIdRef = useRef(generateInstanceId());
  const isOwnerRef = useRef(false);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  // True while this tab is silenced because another tab already owns
  // playback — kept internal, not exposed: the UI still reflects the
  // user's on/off intention, just the audio itself stays muted here.
  const [, setSilencedByOtherTab] = useState(false);

  const writeOwner = useCallback(() => {
    localStorage.setItem(OWNER_KEY, JSON.stringify({ id: instanceIdRef.current, ts: Date.now() }));
  }, []);

  const releaseOwnership = useCallback(() => {
    if (heartbeatIntervalRef.current !== null) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (isOwnerRef.current) {
      const owner = readOwner();
      if (owner?.id === instanceIdRef.current) localStorage.removeItem(OWNER_KEY);
    }
    isOwnerRef.current = false;
  }, []);

  // Claims the lock and actually starts audible playback on `el`. Re-checks
  // shortly after in case another tab claimed the lock in the same instant
  // (both writes are synchronous locally but not atomic across tabs) — if
  // we lost that race, yield instead of playing over the winner.
  const becomeOwnerAndPlay = useCallback((el: HTMLAudioElement) => {
    isOwnerRef.current = true;
    writeOwner();
    setSilencedByOtherTab(false);
    if (heartbeatIntervalRef.current !== null) clearInterval(heartbeatIntervalRef.current);
    heartbeatIntervalRef.current = window.setInterval(writeOwner, HEARTBEAT_MS);
    applyVolume(el);
    el.play().then(() => setIsPlaying(true)).catch(() => {
      // Playback didn't actually start (e.g. autoplay blocked without a
      // user gesture) — don't hold the lock over silence.
      if (isOwnerRef.current) releaseOwnership();
    });

    window.setTimeout(() => {
      const owner = readOwner();
      if (!owner || owner.id !== instanceIdRef.current) {
        isOwnerRef.current = false;
        if (heartbeatIntervalRef.current !== null) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        el.pause();
        setSilencedByOtherTab(true);
      }
    }, CLAIM_CONFIRM_MS);
  }, [applyVolume, writeOwner, releaseOwnership]);

  // Entry point for every "start/resume playback" action. Goes silent
  // instead of claiming the lock if another tab is already the active
  // owner, so at most one open Sybil tab ever emits audio.
  const attemptPlay = useCallback((el: HTMLAudioElement) => {
    const owner = readOwner();
    if (ownerIsActive(owner) && owner.id !== instanceIdRef.current) {
      el.pause();
      isOwnerRef.current = false;
      setSilencedByOtherTab(true);
      setIsPlaying(true);
      return;
    }
    becomeOwnerAndPlay(el);
  }, [becomeOwnerAndPlay]);

  // React to other tabs claiming/releasing the lock, and reclaim it
  // ourselves if it's released (or goes stale, e.g. the owner tab crashed)
  // while we still want music playing.
  useEffect(() => {
    function tryReclaim() {
      if (!isPlayingRef.current || isOwnerRef.current) return;
      const owner = readOwner();
      if (ownerIsActive(owner)) return;
      const el = audioRefs.current[activeRef.current];
      if (el) becomeOwnerAndPlay(el);
    }

    function onStorage(e: StorageEvent) {
      if (e.key !== OWNER_KEY) return;
      if (e.newValue === null) {
        // Owner released the lock — small jitter avoids every waiting tab
        // slamming the lock at the exact same instant.
        window.setTimeout(tryReclaim, 50 + Math.random() * 250);
        return;
      }
      let newOwner: OwnerRecord | null = null;
      try {
        newOwner = JSON.parse(e.newValue);
      } catch {
        return;
      }
      if (newOwner && newOwner.id !== instanceIdRef.current) {
        // Someone else is (now) the owner — go/stay silent immediately.
        isOwnerRef.current = false;
        if (heartbeatIntervalRef.current !== null) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        audioRefs.current[0]?.pause();
        audioRefs.current[1]?.pause();
        if (isPlayingRef.current) setSilencedByOtherTab(true);
      }
    }

    const staleCheck = window.setInterval(tryReclaim, STALE_CHECK_MS);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", releaseOwnership);
    return () => {
      window.clearInterval(staleCheck);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", releaseOwnership);
      releaseOwnership();
    };
  }, [becomeOwnerAndPlay, releaseOwnership]);

  const publicUrl = useCallback((name: string) => {
    return supabase.storage.from(BUCKET).getPublicUrl(name).data.publicUrl;
  }, []);

  const ensureQueue = useCallback((minLen: number) => {
    const names = trackNames;
    if (!names || names.length === 0) return;
    while (queueRef.current.length < minLen) {
      const avoid = queueRef.current[queueRef.current.length - 1];
      queueRef.current.push(...nextPass(names, avoid));
    }
  }, [trackNames]);

  const loadIntoBuffer = useCallback((slot: 0 | 1, name: string) => {
    const el = audioRefs.current[slot];
    if (!el) return;
    el.src = publicUrl(name);
    el.load();
  }, [publicUrl]);

  const advance = useCallback((pausePrev: boolean) => {
    if (!trackNames || trackNames.length === 0) return;
    ensureQueue(2);
    const finished = queueRef.current.shift();
    if (finished) {
      historyRef.current.push(finished);
      if (historyRef.current.length > 50) historyRef.current.shift();
    }
    ensureQueue(2);

    const prevSlot = activeRef.current;
    const nextSlot = prevSlot === 0 ? 1 : 0;
    const nextEl = audioRefs.current[nextSlot];
    if (!nextEl) return;

    if (pausePrev) audioRefs.current[prevSlot]?.pause();

    nextEl.currentTime = 0;
    attemptPlay(nextEl);
    activeRef.current = nextSlot;
    setCurrentTrackLabel(trackLabel(queueRef.current[0]));

    // Preload the track after next into the buffer that just finished.
    const upcoming = queueRef.current[1];
    if (upcoming) loadIntoBuffer(prevSlot, upcoming);
  }, [trackNames, ensureQueue, loadIntoBuffer, attemptPlay]);

  const skipNext = useCallback(() => advance(true), [advance]);

  const skipPrevious = useCallback(() => {
    if (!trackNames || trackNames.length === 0) return;
    const current = queueRef.current[0];
    const prevTrack = historyRef.current.pop();

    if (!prevTrack) {
      // No history — just restart the current track from the top.
      const el = audioRefs.current[activeRef.current];
      if (el) el.currentTime = 0;
      return;
    }

    if (current) queueRef.current.unshift(current);
    queueRef.current.unshift(prevTrack);

    const slot = activeRef.current;
    const el = audioRefs.current[slot];
    if (!el) return;
    el.pause();
    el.src = publicUrl(prevTrack);
    el.load();
    el.currentTime = 0;
    attemptPlay(el);
    setCurrentTrackLabel(trackLabel(prevTrack));

    // Re-preload the upcoming track (now shifted to position 1) into the idle buffer.
    const idleSlot = slot === 0 ? 1 : 0;
    if (queueRef.current[1]) loadIntoBuffer(idleSlot, queueRef.current[1]);
  }, [trackNames, publicUrl, loadIntoBuffer, attemptPlay]);

  const playTrack = useCallback((name: string) => {
    if (!trackNames || trackNames.length === 0) return;
    const current = queueRef.current[0];
    if (current && current !== name) historyRef.current.push(current);

    // Drop the target from wherever it already sits in the queue so it
    // doesn't play again unexpectedly soon after this manual jump.
    queueRef.current = queueRef.current.filter((n) => n !== name);
    queueRef.current.unshift(name);
    ensureQueue(2);

    const slot = activeRef.current;
    const el = audioRefs.current[slot];
    if (!el) return;
    el.pause();
    el.src = publicUrl(name);
    el.load();
    el.currentTime = 0;
    attemptPlay(el);
    setCurrentTrackLabel(trackLabel(name));

    const idleSlot = slot === 0 ? 1 : 0;
    if (queueRef.current[1]) loadIntoBuffer(idleSlot, queueRef.current[1]);
  }, [trackNames, ensureQueue, publicUrl, loadIntoBuffer, attemptPlay]);

  // Fetch track list once.
  useEffect(() => {
    let cancelled = false;
    supabase.storage
      .from(BUCKET)
      .list("", { limit: 200, sortBy: { column: "name", order: "asc" } })
      .then(({ data, error }) => {
        if (cancelled || error) return;
        const names = (data ?? [])
          .filter((f) => f.name && !f.name.endsWith("/"))
          .map((f) => f.name);
        setTrackNames(names);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Once tracks are known, prime the queue and both buffers.
  useEffect(() => {
    if (!trackNames || trackNames.length === 0) return;
    ensureQueue(2);
    setCurrentTrackLabel(trackLabel(queueRef.current[0]));
    loadIntoBuffer(0, queueRef.current[0]);
    if (queueRef.current[1]) loadIntoBuffer(1, queueRef.current[1]);

    const wantsToPlay = localStorage.getItem(ENABLED_KEY) === "true";
    if (wantsToPlay) {
      const el = audioRefs.current[0];
      if (el) {
        // attemptPlay() itself no-ops silently (leaves `el` paused) if
        // another tab already owns playback; browser autoplay-without-a-
        // gesture rejection is likewise swallowed inside it, same as before.
        attemptPlay(el);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackNames]);

  // Keep both buffers' volume in sync with the user's chosen volume —
  // unless a duck is currently overriding it.
  useEffect(() => {
    localStorage.setItem(VOLUME_KEY, String(volume));
    if (duckLevelRef.current !== null) return;
    if (audioRefs.current[0]) audioRefs.current[0].volume = volume;
    if (audioRefs.current[1]) audioRefs.current[1].volume = volume;
  }, [volume]);

  const toggle = useCallback(() => {
    const el = audioRefs.current[activeRef.current];
    if (!el) return;
    if (isPlaying) {
      el.pause();
      releaseOwnership();
      setSilencedByOtherTab(false);
      setIsPlaying(false);
      localStorage.setItem(ENABLED_KEY, "false");
    } else {
      attemptPlay(el);
      localStorage.setItem(ENABLED_KEY, "true");
    }
  }, [isPlaying, attemptPlay, releaseOwnership]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(Math.min(1, Math.max(0, v)));
  }, []);

  const duckTo = useCallback((target: number | null) => {
    if (duckRafRef.current) cancelAnimationFrame(duckRafRef.current);
    const from = duckLevelRef.current ?? volumeRef.current;
    const to = target ?? volumeRef.current;
    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DUCK_TWEEN_MS);
      const level = from + (to - from) * t;
      const el = audioRefs.current[activeRef.current];
      if (el) el.volume = level;
      if (t < 1) {
        duckLevelRef.current = level;
        duckRafRef.current = requestAnimationFrame(step);
      } else {
        duckLevelRef.current = target;
        duckRafRef.current = null;
      }
    };
    duckRafRef.current = requestAnimationFrame(step);
  }, []);

  return (
    <MusicPlayerContext.Provider
      value={{
        ready: trackNames !== null,
        hasTracks: !!trackNames && trackNames.length > 0,
        isPlaying,
        volume,
        currentTrackLabel,
        tracks: (trackNames ?? []).map((name) => ({ name, label: trackLabel(name) })),
        toggle,
        setVolume,
        skipNext,
        skipPrevious,
        playTrack,
        duckTo,
      }}
    >
      {children}
      <audio
        ref={(el) => {
          audioRefs.current[0] = el;
        }}
        onEnded={() => advance(false)}
        preload="auto"
      />
      <audio
        ref={(el) => {
          audioRefs.current[1] = el;
        }}
        onEnded={() => advance(false)}
        preload="auto"
      />
    </MusicPlayerContext.Provider>
  );
}
