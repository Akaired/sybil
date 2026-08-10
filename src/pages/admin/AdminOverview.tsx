import { useEffect, useState } from "react";
import { adminApi, adminApiErrorMessage } from "../../lib/adminApi";
import type { AdminOverviewResponse } from "../../lib/adminTypes";
import { AdminLoading, AdminError } from "../../components/admin/AdminStatus";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AdminOverview() {
  const [data, setData] = useState<AdminOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi<AdminOverviewResponse>("overview")
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(adminApiErrorMessage(err, "Couldn't load the overview."));
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

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-3">
          <p className="text-xs text-fg-subtle mb-1">Workspaces</p>
          <p className="text-xl font-semibold text-fg-primary">{data.workspaces.length}</p>
        </div>
        <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-3">
          <p className="text-xs text-fg-subtle mb-1">Members (total)</p>
          <p className="text-xl font-semibold text-fg-primary">
            {data.workspaces.reduce((sum, w) => sum + w.member_count, 0)}
          </p>
        </div>
        <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-3">
          <p className="text-xs text-fg-subtle mb-1">LLM calls (total)</p>
          <p className="text-xl font-semibold text-fg-primary">{data.totals.llm_calls}</p>
        </div>
        <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-3">
          <p className="text-xs text-fg-subtle mb-1">Web calls (total)</p>
          <p className="text-xl font-semibold text-fg-primary">{data.totals.web_calls}</p>
        </div>
      </div>

      <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-fg-subtle/15 text-left text-fg-subtle">
                <th className="font-medium px-4 py-2.5">Workspace</th>
                <th className="font-medium px-4 py-2.5">Plan</th>
                <th className="font-medium px-4 py-2.5 text-right">Members</th>
                <th className="font-medium px-4 py-2.5">Created</th>
                <th className="font-medium px-4 py-2.5">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {data.workspaces.map((ws) => (
                <tr key={ws.id} className="border-b border-fg-subtle/10 last:border-0">
                  <td className="px-4 py-2.5 text-fg-primary font-medium">{ws.name}</td>
                  <td className="px-4 py-2.5 text-fg-muted capitalize">{ws.plan}</td>
                  <td className="px-4 py-2.5 text-fg-muted text-right">{ws.member_count}</td>
                  <td className="px-4 py-2.5 text-fg-muted">{formatDate(ws.created_at)}</td>
                  <td className="px-4 py-2.5 text-fg-muted">{formatRelative(ws.last_activity_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
