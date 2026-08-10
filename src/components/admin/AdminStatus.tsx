import { Loader2, AlertCircle } from "lucide-react";

export function AdminLoading() {
  return (
    <div className="flex items-center gap-2 text-fg-muted text-sm py-8 justify-center">
      <Loader2 size={16} className="animate-spin" />
      Loading…
    </div>
  );
}

export function AdminError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-danger text-sm bg-danger/10 border border-danger/25 rounded-md px-3 py-2.5">
      <AlertCircle size={15} strokeWidth={2} className="shrink-0" />
      {message}
    </div>
  );
}

export function AdminEmpty({ message }: { message: string }) {
  return <p className="text-fg-subtle text-sm py-8 text-center">{message}</p>;
}
