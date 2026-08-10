import { useEffect, useState } from "react";
import { ArrowLeft, Save, Trash2, RefreshCw } from "lucide-react";
import { supabase } from "../config/supabase";
import Modal from "./Modal";

interface Sentinel {
  id: string;
  condition_text: string;
  type: "web" | "email" | "internal";
  status: "active" | "paused" | "triggered" | "error";
  frequency_min: number;
  config: { target?: string | null } | null;
}

interface EditSentinelModalProps {
  sentinel: Sentinel | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

const FREQUENCY_OPTIONS = [
  { value: 10, label: "10 min" },
  { value: 15, label: "15 min" },
  { value: 60, label: "1h" },
  { value: 180, label: "3h" },
  { value: 360, label: "6h" },
  { value: 720, label: "12h" },
  { value: 1440, label: "24h" },
];

export default function EditSentinelModal({
  sentinel,
  onClose,
  onSaved,
  onDeleted,
}: EditSentinelModalProps) {
  const [conditionText, setConditionText] = useState("");
  const [target, setTarget] = useState("");
  const [frequencyMin, setFrequencyMin] = useState(360);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (sentinel) {
      setConditionText(sentinel.condition_text);
      setTarget(sentinel.config?.target ?? "");
      setFrequencyMin(sentinel.frequency_min);
      setConfirmingDelete(false);
      setError(null);
    }
  }, [sentinel]);

  if (!sentinel) return null;

  async function handleSave() {
    if (!sentinel) return;
    if (!conditionText.trim()) {
      setError("Condition can't be empty.");
      return;
    }
    setSaving(true);
    setError(null);

    const { error: err } = await supabase
      .from("sybil_sentinels")
      .update({
        condition_text: conditionText,
        frequency_min: frequencyMin,
        config: { target: target || null },
      })
      .eq("id", sentinel.id);

    setSaving(false);

    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
    onClose();
  }

  async function handleDelete() {
    if (!sentinel) return;
    setDeleting(true);
    setError(null);

    const { error: err } = await supabase
      .from("sybil_sentinels")
      .delete()
      .eq("id", sentinel.id);

    setDeleting(false);

    if (err) {
      setError(err.message);
      return;
    }
    onDeleted();
    onClose();
  }

  return (
    <Modal open={!!sentinel} onClose={onClose} title="Configure sentinel">
      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1.5">Condition</label>
          <input
            type="text"
            value={conditionText}
            onChange={(e) => setConditionText(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-fg-subtle/25 bg-bg-base text-fg-primary text-sm focus:outline-none focus:border-sine-indigo/60"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1.5">Target</label>
          <input
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="URL, contact, or reference"
            className="w-full px-3 py-2 rounded-md border border-fg-subtle/25 bg-bg-base text-fg-primary text-sm font-mono placeholder:text-fg-subtle focus:outline-none focus:border-sine-indigo/60"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1.5">Check every</label>
          <div className="flex gap-1.5 flex-wrap">
            {FREQUENCY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFrequencyMin(opt.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium font-mono transition-colors duration-150 cursor-pointer ${
                  frequencyMin === opt.value
                    ? "bg-sine-indigo/18 text-sine-indigo border border-sine-indigo/40"
                    : "bg-bg-surface text-fg-muted border border-fg-subtle/20 hover:text-fg-primary"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg px-3.5 py-2.5 text-xs text-fg-primary">
            {error}
          </div>
        )}

        <div className="h-px bg-fg-subtle/15" />

        {confirmingDelete ? (
          <div className="bg-danger/10 border border-danger/30 rounded-lg px-3.5 py-3 flex items-center justify-between gap-3">
            <span className="text-xs text-fg-primary">Delete this sentinel permanently?</span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setConfirmingDelete(false)}
                aria-label="Cancel delete"
                title="Cancel"
                className="flex items-center justify-center w-8 h-8 rounded-md border border-fg-subtle/25 text-fg-muted hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 cursor-pointer"
              >
                <ArrowLeft size={14} strokeWidth={1.8} />
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                aria-label="Confirm delete"
                title="Delete"
                className="flex items-center justify-center w-8 h-8 rounded-md bg-danger text-bg-base hover:bg-danger/90 transition-colors duration-150 cursor-pointer disabled:opacity-50"
              >
                {deleting ? <RefreshCw size={14} strokeWidth={1.8} className="animate-spin" /> : <Trash2 size={14} strokeWidth={1.8} />}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between mt-1">
            <button
              onClick={() => setConfirmingDelete(true)}
              aria-label="Delete sentinel"
              title="Delete sentinel"
              className="flex items-center justify-center w-9 h-9 rounded-lg border border-danger/30 text-danger hover:bg-danger/10 transition-colors duration-150 cursor-pointer"
            >
              <Trash2 size={16} strokeWidth={1.8} />
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                aria-label="Cancel"
                title="Cancel"
                className="flex items-center justify-center w-9 h-9 rounded-lg border border-fg-subtle/25 text-fg-muted hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 cursor-pointer"
              >
                <ArrowLeft size={16} strokeWidth={1.8} />
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                aria-label="Save changes"
                title="Save changes"
                className="flex items-center justify-center w-9 h-9 rounded-lg bg-success text-bg-base hover:bg-success/90 transition-colors duration-150 cursor-pointer disabled:opacity-50"
              >
                {saving ? <RefreshCw size={16} strokeWidth={1.8} className="animate-spin" /> : <Save size={16} strokeWidth={1.8} />}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
