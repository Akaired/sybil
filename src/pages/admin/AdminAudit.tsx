import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { adminApi, adminApiErrorMessage } from "../../lib/adminApi";
import type { AdminAuditListResponse } from "../../lib/adminTypes";
import { AdminLoading, AdminError, AdminEmpty } from "../../components/admin/AdminStatus";

const PAGE_SIZE = 50;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const ROLE_LABEL: Record<string, string> = { staff: "Staff", superadmin: "Superadmin" };

export default function AdminAudit() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminAuditListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi<AdminAuditListResponse>("audit_list", { page, page_size: PAGE_SIZE })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(adminApiErrorMessage(err, "Couldn't load the audit log."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  if (loading) return <AdminLoading />;
  if (error) return <AdminError message={error} />;
  if (!data) return null;

  const totalPages = Math.max(1, Math.ceil(data.total / data.page_size));

  return (
    <div className="space-y-3">
      <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg overflow-hidden">
        {data.entries.length === 0 ? (
          <AdminEmpty message="No audit entries yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-fg-subtle/15 text-left text-fg-subtle">
                  <th className="font-medium px-4 py-2.5">When</th>
                  <th className="font-medium px-4 py-2.5">Who</th>
                  <th className="font-medium px-4 py-2.5">Level</th>
                  <th className="font-medium px-4 py-2.5">Action</th>
                  <th className="font-medium px-4 py-2.5">Target</th>
                  <th className="font-medium px-4 py-2.5">Outcome</th>
                  <th className="font-medium px-4 py-2.5">Payload</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-fg-subtle/10 last:border-0 align-top">
                    <td className="px-4 py-2.5 text-fg-muted whitespace-nowrap">{formatDateTime(entry.created_at)}</td>
                    <td className="px-4 py-2.5 text-fg-primary">{entry.admin_display_name}</td>
                    <td className="px-4 py-2.5 text-fg-muted">
                      {entry.admin_role ? ROLE_LABEL[entry.admin_role] : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-fg-primary font-mono text-xs">{entry.action}</td>
                    <td className="px-4 py-2.5 text-fg-muted">
                      {entry.target_type ? `${entry.target_type}${entry.target_id ? ` · ${entry.target_id}` : ""}` : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          entry.outcome === "denied"
                            ? "bg-danger/14 text-danger"
                            : entry.outcome === "error"
                              ? "bg-warning/14 text-warning"
                              : "bg-success/14 text-success"
                        }`}
                      >
                        {entry.outcome}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {entry.payload && Object.keys(entry.payload).length > 0 ? (
                        <details>
                          <summary className="cursor-pointer text-xs text-fg-subtle hover:text-fg-muted">
                            view
                          </summary>
                          <pre className="mt-1 text-xs text-fg-muted bg-bg-base rounded px-2 py-1.5 max-w-xs overflow-x-auto">
                            {JSON.stringify(entry.payload, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        <span className="text-fg-subtle text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-fg-muted">
          <span>
            Page {data.page} of {totalPages} · {data.total} total
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 border border-fg-subtle/25 rounded-md px-2.5 py-1 hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <ChevronLeft size={13} /> Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="inline-flex items-center gap-1 border border-fg-subtle/25 rounded-md px-2.5 py-1 hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Next <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
