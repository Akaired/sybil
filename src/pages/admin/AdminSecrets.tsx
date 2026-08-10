import { useContext, useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { AuthContext } from "../../contexts/AuthContext";
import { adminApi, adminApiErrorMessage } from "../../lib/adminApi";
import type { AdminOkResponse, AdminSecret, AdminSecretsListResponse } from "../../lib/adminTypes";
import { AdminLoading, AdminError } from "../../components/admin/AdminStatus";
import Modal from "../../components/Modal";
import SecretsLocked from "../../components/admin/SecretsLocked";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SecretRow({ secret, onSaved }: { secret: AdminSecret; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function clearField() {
    setValue("");
    setShowValue(false);
  }

  async function confirmSave() {
    setSaving(true);
    setError(null);
    try {
      await adminApi<AdminOkResponse>("secret_set", { name: secret.name, value });
      clearField();
      setConfirmOpen(false);
      onSaved();
    } catch (err) {
      setError(adminApiErrorMessage(err, "Couldn't save this secret."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-3 border-b border-fg-subtle/10 last:border-0">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[13.5px] text-fg-primary font-medium">{secret.name}</p>
          <p className="text-xs text-fg-subtle mt-0.5">
            •••• {secret.last4 ?? "????"} · {secret.source === "vault" ? "Vault" : "env"} · updated{" "}
            {formatDateTime(secret.updated_at)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              type={showValue ? "text" : "password"}
              autoComplete="new-password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="New value"
              className="w-56 bg-bg-base border border-fg-subtle/25 rounded-md pl-3 pr-8 py-1.5 text-[13px] text-fg-primary placeholder:text-fg-subtle focus:outline-none focus:border-fg-subtle/50"
            />
            <button
              type="button"
              onClick={() => setShowValue((v) => !v)}
              title={showValue ? "Hide" : "Show"}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg-muted cursor-pointer"
            >
              {showValue ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={!value}
            className="bg-warning text-bg-base text-[13px] font-semibold rounded-md px-3 py-1.5 hover:opacity-90 transition-opacity duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Save
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-danger mt-2">{error}</p>}

      <Modal
        open={confirmOpen}
        onClose={() => !saving && setConfirmOpen(false)}
        title="Confirm secret update"
        footer={
          <>
            <button
              onClick={() => setConfirmOpen(false)}
              disabled={saving}
              className="text-[13px] font-medium text-fg-muted hover:text-fg-primary transition-colors duration-150 cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={confirmSave}
              disabled={saving}
              className="bg-warning text-bg-base text-[13px] font-semibold rounded-md px-4 py-2 hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 cursor-pointer"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          You're about to overwrite <span className="text-fg-primary font-semibold">{secret.name}</span> for every
          workspace on this platform. This can't be undone.
        </p>
      </Modal>
    </div>
  );
}

function AdminSecretsSuperadmin() {
  const [secrets, setSecrets] = useState<AdminSecret[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await adminApi<AdminSecretsListResponse>("secrets_list");
      setSecrets(res.secrets);
      setError(null);
    } catch (err) {
      setError(adminApiErrorMessage(err, "Couldn't load secrets."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) return <AdminLoading />;
  if (error && !secrets) return <AdminError message={error} />;
  if (!secrets) return null;

  return (
    <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg overflow-hidden">
      {secrets.map((s) => (
        <SecretRow key={s.name} secret={s} onSaved={load} />
      ))}
    </div>
  );
}

export default function AdminSecrets() {
  const { platformRole } = useContext(AuthContext);
  if (platformRole !== "superadmin") return <SecretsLocked />;
  return <AdminSecretsSuperadmin />;
}
