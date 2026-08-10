/**
 * Small pill marking a feature as not yet available. Used across the
 * Settings tabs (Skills, Plan) wherever a control is present but inert.
 */
export default function ComingSoonBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`shrink-0 px-2.5 py-1 rounded-full font-mono text-[11px] bg-fg-subtle/10 border border-fg-subtle/30 text-fg-subtle ${className}`}
    >
      Coming soon
    </span>
  );
}
