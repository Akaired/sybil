import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

interface DemoVideo {
  id: string;
  title: string;
  src: string;
  poster?: string;
}

const VIDEOS_BASE =
  "https://uhrqlwoejawnnhdeabob.supabase.co/storage/v1/object/public/videos";

const DEMO_VIDEOS: DemoVideo[] = [
  { id: "overview", title: "Product overview", src: `${VIDEOS_BASE}/Sybil.mp4` },
  { id: "hyperframes", title: "Sybil in motion", src: `${VIDEOS_BASE}/${encodeURIComponent("Sybil Hyperframes.mp4")}` },
];

interface DemoVideoModalProps {
  open: boolean;
  onClose: () => void;
}

export default function DemoVideoModal({ open, onClose }: DemoVideoModalProps) {
  const [activeId, setActiveId] = useState(DEMO_VIDEOS[0].id);
  const videoRef = useRef<HTMLVideoElement>(null);
  const active = DEMO_VIDEOS.find((v) => v.id === activeId) ?? DEMO_VIDEOS[0];

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) setActiveId(DEMO_VIDEOS[0].id);
  }, [open]);

  if (!open) return null;

  function selectVideo(id: string) {
    setActiveId(id);
    videoRef.current?.load();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl bg-bg-elevated border border-fg-subtle/20 rounded-xl shadow-xl p-6 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-label="Demo videos"
      >
        <div className="flex items-center justify-between gap-4 mb-5">
          <h2 className="text-base font-semibold text-fg-primary">{active.title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-fg-subtle hover:text-fg-primary cursor-pointer transition-colors duration-150"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="rounded-lg overflow-hidden bg-black">
          <video
            ref={videoRef}
            key={active.id}
            controls
            autoPlay
            className="w-full aspect-video"
            poster={active.poster}
          >
            <source src={active.src} type="video/mp4" />
          </video>
        </div>

        <div className="flex gap-3 mt-4">
          {DEMO_VIDEOS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => selectVideo(v.id)}
              className={`flex-1 text-left rounded-lg overflow-hidden border transition-colors duration-150 cursor-pointer ${
                v.id === activeId
                  ? "border-fg-accent"
                  : "border-fg-subtle/20 hover:border-fg-subtle/40"
              }`}
            >
              <div className="aspect-video bg-bg-surface flex items-center justify-center">
                {v.poster ? (
                  <img src={v.poster} alt="" className="w-full h-full object-cover" />
                ) : (
                  <video src={v.src} className="w-full h-full object-cover pointer-events-none" muted preload="metadata" />
                )}
              </div>
              <div className="px-3 py-2 text-xs font-medium text-fg-primary truncate">
                {v.title}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
