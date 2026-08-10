import { useEffect, useState } from "react";
import { adminApi, adminApiErrorMessage } from "../../lib/adminApi";
import type { AdminUsageBucket, AdminUsageResponse } from "../../lib/adminTypes";
import { AdminLoading, AdminError, AdminEmpty } from "../../components/admin/AdminStatus";

const PROVIDER_ICON_BASE =
  "https://uhrqlwoejawnnhdeabob.supabase.co/storage/v1/object/public/brand-assets/providers";

function providerIcon(name: string): string | null {
  if (name === "AI/ML API") return `${PROVIDER_ICON_BASE}/aiml.svg`;
  if (name === "OpenRouter") return `${PROVIDER_ICON_BASE}/openrouter.svg`;
  return null;
}

type RangeKey = "24h" | "7d" | "30d";
const RANGES: { key: RangeKey; label: string; hours: number }[] = [
  { key: "24h", label: "24h", hours: 24 },
  { key: "7d", label: "7d", hours: 24 * 7 },
  { key: "30d", label: "30d", hours: 24 * 30 },
];

function UsageTable({
  rows,
  keyLabel,
  showTokens,
  iconFor,
}: {
  rows: AdminUsageBucket[];
  keyLabel: string;
  showTokens: boolean;
  iconFor?: (key: string) => string | null;
}) {
  if (rows.length === 0) return <AdminEmpty message="No calls in this range." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-fg-subtle/15 text-left text-fg-subtle">
            <th className="font-medium px-4 py-2.5">{keyLabel}</th>
            <th className="font-medium px-4 py-2.5 text-right">Calls</th>
            {showTokens && <th className="font-medium px-4 py-2.5 text-right">Tokens</th>}
            <th className="font-medium px-4 py-2.5 text-right">Avg latency</th>
            <th className="font-medium px-4 py-2.5 text-right">Failures</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const icon = iconFor?.(r.key) ?? null;
            return (
              <tr key={r.key} className="border-b border-fg-subtle/10 last:border-0">
                <td className="px-4 py-2.5 text-fg-primary font-medium">
                  <span className="inline-flex items-center gap-2">
                    {icon && <img src={icon} alt="" className="w-4 h-4" />}
                    {r.key}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-fg-muted text-right">{r.calls}</td>
                {showTokens && <td className="px-4 py-2.5 text-fg-muted text-right">{r.tokens ?? 0}</td>}
                <td className="px-4 py-2.5 text-fg-muted text-right">{r.avg_latency_ms}ms</td>
                <td className={`px-4 py-2.5 text-right ${r.failures > 0 ? "text-danger" : "text-fg-muted"}`}>
                  {r.failures}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminUsage() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [data, setData] = useState<AdminUsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const hours = RANGES.find((r) => r.key === range)!.hours;
    const from = new Date(Date.now() - hours * 3600_000).toISOString();
    const to = new Date().toISOString();
    adminApi<AdminUsageResponse>("usage", { from, to })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(adminApiErrorMessage(err, "Couldn't load usage."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const llmTotals = data
    ? data.llm.by_function.reduce(
        (acc, b) => ({ calls: acc.calls + b.calls, tokens: acc.tokens + (b.tokens ?? 0) }),
        { calls: 0, tokens: 0 },
      )
    : null;
  const webTotals = data
    ? data.web.by_action.reduce((acc, b) => ({ calls: acc.calls + b.calls }), { calls: 0 })
    : null;

  return (
    <div className="space-y-5">
      <div className="flex bg-bg-elevated border border-fg-subtle/20 rounded-lg p-[3px] w-fit">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`px-4 py-1.5 rounded-md text-[13px] font-semibold transition-colors duration-150 cursor-pointer ${
              range === r.key ? "bg-warning text-bg-base" : "text-fg-muted hover:text-fg-primary"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {loading && <AdminLoading />}
      {error && <AdminError message={error} />}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-3">
              <p className="text-xs text-fg-subtle mb-1">LLM calls</p>
              <p className="text-xl font-semibold text-fg-primary">{llmTotals?.calls ?? 0}</p>
            </div>
            <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-3">
              <p className="text-xs text-fg-subtle mb-1">LLM tokens</p>
              <p className="text-xl font-semibold text-fg-primary">{llmTotals?.tokens ?? 0}</p>
            </div>
            <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-3">
              <p className="text-xs text-fg-subtle mb-1">Web calls</p>
              <p className="text-xl font-semibold text-fg-primary">{webTotals?.calls ?? 0}</p>
            </div>
            <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-3">
              <p className="text-xs text-fg-subtle mb-1">Range</p>
              <p className="text-xl font-semibold text-fg-primary">{range}</p>
            </div>
          </div>

          <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg overflow-hidden">
            <p className="text-xs font-semibold text-fg-muted px-4 pt-3 pb-1">By function</p>
            <UsageTable rows={data.llm.by_function} keyLabel="Function" showTokens />
          </div>

          <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg overflow-hidden">
            <p className="text-xs font-semibold text-fg-muted px-4 pt-3 pb-1">By provider</p>
            <UsageTable rows={data.llm.by_provider} keyLabel="Provider" showTokens iconFor={providerIcon} />
          </div>
        </>
      )}
    </div>
  );
}
