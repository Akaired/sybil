import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="w-full min-h-screen flex flex-col items-center justify-center px-6 text-center gap-5 bg-bg-primary">
      <h1 className="text-2xl font-semibold text-fg-primary">Page not found</h1>
      <p className="text-fg-muted">This page doesn&apos;t exist, or moved.</p>
      <Link
        to="/"
        className="inline-flex items-center px-6 py-3 rounded-lg border border-fg-accent text-fg-accent font-medium text-sm hover:bg-fg-accent/10 transition-colors duration-150"
      >
        ← Back home
      </Link>
    </div>
  );
}
