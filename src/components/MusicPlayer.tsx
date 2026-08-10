import { useEffect, useRef, useState } from "react";
import { ListMusic, Music, Pause, Play, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { useMusicPlayer } from "../contexts/MusicPlayerContext";

function VolumeIcon({ volume }: { volume: number }) {
  if (volume === 0) return <VolumeX size={16} strokeWidth={1.8} className="text-fg-subtle shrink-0" />;
  if (volume < 0.5) return <Volume1 size={16} strokeWidth={1.8} className="text-fg-subtle shrink-0" />;
  return <Volume2 size={16} strokeWidth={1.8} className="text-fg-subtle shrink-0" />;
}

/**
 * Top bar ambient music control. Playback state lives in
 * MusicPlayerContext (mounted at the app root) so it survives navigation —
 * this component is just the dropdown UI on top of it.
 */
export default function MusicPlayer() {
  const [open, setOpen] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const {
    ready,
    hasTracks,
    isPlaying,
    volume,
    currentTrackLabel,
    tracks,
    toggle,
    setVolume,
    skipNext,
    skipPrevious,
    playTrack,
  } = useMusicPlayer();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const disabled = !ready || !hasTracks;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Ambient music"
        title="Ambient music"
        className={`p-1.5 rounded-lg transition-colors duration-150 cursor-pointer ${
          isPlaying ? "text-sine-indigo" : "text-fg-subtle hover:text-fg-primary hover:bg-bg-surface/50"
        }`}
      >
        <Music size={18} strokeWidth={1.8} />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] w-72 bg-bg-elevated border border-fg-subtle/20 rounded-xl shadow-lg py-3 px-3.5 z-50">
          <div className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-3">
            Ambient Music
          </div>

          <div className={disabled ? "opacity-50" : ""}>
            <div className="min-w-0 mb-2.5">
              <p className="text-sm font-medium text-fg-primary truncate">
                {disabled ? "No tracks yet" : currentTrackLabel ?? "Loading…"}
              </p>
              <p className="text-xs text-fg-subtle truncate">Instrumental loop</p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={skipPrevious}
                disabled={disabled}
                aria-label="Previous track"
                className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-fg-muted hover:bg-bg-surface hover:text-fg-primary transition-colors duration-150 disabled:cursor-not-allowed cursor-pointer"
              >
                <SkipBack size={15} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={toggle}
                disabled={disabled}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="shrink-0 w-9 h-9 rounded-full bg-bg-surface flex items-center justify-center text-fg-primary hover:bg-sine-indigo/18 hover:text-sine-indigo transition-colors duration-150 disabled:cursor-not-allowed cursor-pointer"
              >
                {isPlaying ? <Pause size={16} strokeWidth={1.8} /> : <Play size={16} strokeWidth={1.8} />}
              </button>
              <button
                type="button"
                onClick={skipNext}
                disabled={disabled}
                aria-label="Next track"
                className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-fg-muted hover:bg-bg-surface hover:text-fg-primary transition-colors duration-150 disabled:cursor-not-allowed cursor-pointer"
              >
                <SkipForward size={15} strokeWidth={1.8} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2.5 mt-4">
            <VolumeIcon volume={volume} />
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
              className="w-full accent-sine-indigo cursor-pointer"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowPlaylist((s) => !s)}
            disabled={disabled}
            className="w-full flex items-center justify-between gap-2 mt-4 pt-3 border-t border-fg-subtle/15 text-xs font-semibold text-fg-subtle uppercase tracking-wide disabled:cursor-not-allowed cursor-pointer hover:text-fg-primary transition-colors duration-150"
          >
            <span className="flex items-center gap-1.5">
              <ListMusic size={13} strokeWidth={1.8} />
              Playlist ({tracks.length})
            </span>
            <span className={`transition-transform duration-150 ${showPlaylist ? "rotate-180" : ""}`}>▾</span>
          </button>

          {showPlaylist && (
            <ul className="mt-2 max-h-52 overflow-y-auto -mx-1">
              {tracks.map((track) => {
                const active = track.label === currentTrackLabel;
                return (
                  <li key={track.name}>
                    <button
                      type="button"
                      onClick={() => playTrack(track.name)}
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-sm truncate transition-colors duration-150 cursor-pointer ${
                        active
                          ? "text-sine-indigo font-medium bg-sine-indigo/10"
                          : "text-fg-muted hover:text-fg-primary hover:bg-bg-surface/50"
                      }`}
                    >
                      {track.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
