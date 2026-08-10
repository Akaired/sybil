import { useContext, useEffect, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { AuthContext } from "../../contexts/AuthContext";
import { adminApi, adminApiErrorMessage } from "../../lib/adminApi";
import type { AdminOkResponse, AdminProvider, AdminProvidersListResponse } from "../../lib/adminTypes";
import { AdminLoading, AdminError, AdminEmpty } from "../../components/admin/AdminStatus";

const PROVIDER_ICON_BASE =
  "https://uhrqlwoejawnnhdeabob.supabase.co/storage/v1/object/public/brand-assets/providers";

function providerIcon(name: string): string | null {
  if (name === "AI/ML API") return `${PROVIDER_ICON_BASE}/aiml.svg`;
  if (name === "OpenRouter") return `${PROVIDER_ICON_BASE}/openrouter.svg`;
  return null;
}

function Toggle({
  checked,
  onChange,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      disabled={disabled}
      onClick={onChange}
      className={`relative w-9 h-5 rounded-full shrink-0 transition-colors duration-150 ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${checked ? "bg-warning" : "bg-fg-subtle/20"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-150 ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export default function AdminProviders() {
  const { platformRole } = useContext(AuthContext);
  const canEdit = platformRole === "superadmin";

  const [providers, setProviders] = useState<AdminProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await adminApi<AdminProvidersListResponse>("providers_list");
      setProviders(res.providers);
      setError(null);
    } catch (err) {
      setError(adminApiErrorMessage(err, "Couldn't load providers."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function updateProvider(id: string, patch: { active?: boolean; priority?: number }) {
    setSavingId(id);
    try {
      await adminApi<AdminOkResponse>("providers_update", { id, ...patch });
      await load();
    } catch (err) {
      setError(adminApiErrorMessage(err, "Couldn't update the provider."));
    } finally {
      setSavingId(null);
    }
  }

  async function move(index: number, direction: -1 | 1) {
    if (!providers) return;
    const target = index + direction;
    if (target < 0 || target >= providers.length) return;
    const a = providers[index];
    const b = providers[target];
    setSavingId(a.id);
    try {
      await Promise.all([
        adminApi<AdminOkResponse>("providers_update", { id: a.id, priority: b.priority }),
        adminApi<AdminOkResponse>("providers_update", { id: b.id, priority: a.priority }),
      ]);
      await load();
    } catch (err) {
      setError(adminApiErrorMessage(err, "Couldn't reorder providers."));
    } finally {
      setSavingId(null);
    }
  }

  if (loading) return <AdminLoading />;
  if (error && !providers) return <AdminError message={error} />;
  if (!providers) return null;

  const readOnlyTitle = "Read-only";

  return (
    <div className="space-y-3">
      {error && <AdminError message={error} />}
      <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg overflow-hidden">
        {providers.length === 0 ? (
          <AdminEmpty message="No providers configured." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-fg-subtle/15 text-left text-fg-subtle">
                  <th className="font-medium px-4 py-2.5">Provider</th>
                  <th className="font-medium px-4 py-2.5">Model</th>
                  <th className="font-medium px-4 py-2.5 text-right">Priority</th>
                  <th className="font-medium px-4 py-2.5 text-center">Active</th>
                  <th className="font-medium px-4 py-2.5 text-right">Reorder</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p, i) => {
                  const icon = providerIcon(p.name);
                  const saving = savingId === p.id;
                  return (
                    <tr key={p.id} className="border-b border-fg-subtle/10 last:border-0">
                      <td className="px-4 py-2.5 text-fg-primary font-medium">
                        <span className="inline-flex items-center gap-2">
                          {icon && <img src={icon} alt="" className="w-4 h-4" />}
                          {p.name}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-fg-muted font-mono text-xs">{p.model}</td>
                      <td className="px-4 py-2.5 text-fg-muted text-right">{p.priority}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-center">
                          <Toggle
                            checked={p.is_active}
                            disabled={!canEdit || saving}
                            title={canEdit ? undefined : readOnlyTitle}
                            onChange={() => updateProvider(p.id, { active: !p.is_active })}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            title={canEdit ? "Move up" : readOnlyTitle}
                            disabled={!canEdit || saving || i === 0}
                            onClick={() => move(i, -1)}
                            className="p-1 rounded border border-fg-subtle/25 text-fg-muted hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                          >
                            <ArrowUp size={12} strokeWidth={2} />
                          </button>
                          <button
                            title={canEdit ? "Move down" : readOnlyTitle}
                            disabled={!canEdit || saving || i === providers.length - 1}
                            onClick={() => move(i, 1)}
                            className="p-1 rounded border border-fg-subtle/25 text-fg-muted hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                          >
                            <ArrowDown size={12} strokeWidth={2} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
