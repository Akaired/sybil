import { useEffect, useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { adminApi, adminApiErrorMessage } from "../../lib/adminApi";
import type { AdminHealthResponse, AdminSentinelCheckResult } from "../../lib/adminTypes";
import { AdminLoading, AdminError, AdminEmpty } from "../../components/admin/AdminStatus";

const STALE_CRON_THRESHOLD_MIN = 30;

function minutesAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CheckNowButton({ sentinelId }: { sentinelId: string }) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleClick() {
    setChecking(true);
    setResult(null);
    try {
      const res = await adminApi<AdminSentinelCheckResult>("sentinel_check_now", { sentinel_id: sentinelId });
      const status = res.results?.[0]?.status ?? "unknown";
      setResult(status);
    } catch (err) {
      setResult(adminApiErrorMessage(err, "error"));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      {result && <span className="text-xs text-fg-subtle">{result}</span>}
      <button
        onClick={handleClick}
        disabled={checking}
        className="inline-flex items-center gap-1.5 border border-fg-subtle/25 rounded-md px-2.5 py-1 text-xs font-medium text-fg-muted hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
      >
        <RefreshCw size={12} strokeWidth={2} className={checking ? "animate-spin" : ""} />
        Check now
      </button>
    </div>
  );
}

export default function AdminHealth() {
  const [data, setData] = useState<AdminHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    adminApi<AdminHealthResponse>("health")
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(adminApiErrorMessage(err, "Couldn't load health."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <AdminLoading />;
  if (error) return <AdminError message={error} />;
  if (!data) return null;

  const lastRunAgo = minutesAgo(data.last_run_at);
  const oldestDueAgo = minutesAgo(data.oldest_next_check_at);
  const cronStale = oldestDueAgo !== null && oldestDueAgo > STALE_CRON_THRESHOLD_MIN;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-3">
          <p className="text-xs text-fg-subtle mb-1">Last sentinel-check run</p>
          <p className="text-base font-semibold text-fg-primary">
            {lastRunAgo === null ? "Never" : `${lastRunAgo}m ago`}
          </p>
        </div>
        <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-3">
          <p className="text-xs text-fg-subtle mb-1">Active sentinels</p>
          <p className="text-base font-semibold text-fg-primary">{data.active_sentinel_count}</p>
        </div>
        <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-3">
          <p className="text-xs text-fg-subtle mb-1">Sentinels in error</p>
          <p className={`text-base font-semibold ${data.errored_sentinels.length > 0 ? "text-danger" : "text-fg-primary"}`}>
            {data.errored_sentinels.length}
          </p>
        </div>
      </div>

      {cronStale && (
        <div className="flex items-center gap-2 text-warning text-sm bg-warning/10 border border-warning/25 rounded-md px-3 py-2.5">
          <AlertTriangle size={15} strokeWidth={2} className="shrink-0" />
          Oldest due check is {oldestDueAgo}m overdue — the sentinel-check cron may be stuck.
        </div>
      )}

      <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg overflow-hidden">
        <p className="text-xs font-semibold text-fg-muted px-4 pt-3 pb-1">Sentinels in error</p>
        {data.errored_sentinels.length === 0 ? (
          <AdminEmpty message="No sentinels in error." />
        ) : (
          <div className="divide-y divide-fg-subtle/10">
            {data.errored_sentinels.map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] text-fg-primary truncate">{s.condition_text}</p>
                  <p className="text-xs text-danger mt-0.5">{s.last_error || "No error detail"}</p>
                  <p className="text-xs text-fg-subtle mt-0.5">{formatDateTime(s.last_error_at)}</p>
                </div>
                <CheckNowButton sentinelId={s.id} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
