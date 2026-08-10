import { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Globe, Mail, Target } from "lucide-react";
import { supabase } from "../config/supabase";
import { AuthContext } from "../contexts/AuthContext";
import Modal from "./Modal";

type SentinelType = "web" | "email" | "internal";

interface NewSentinelModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
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

const TYPE_OPTIONS: {
  type: SentinelType;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    type: "web",
    label: "Web",
    description: "Watch a URL and get notified when its content changes.",
    icon: <Globe size={18} strokeWidth={1.6} />,
  },
  {
    type: "email",
    label: "Email",
    description: "Alert when a contact stays silent for too long.",
    icon: <Mail size={18} strokeWidth={1.6} />,
  },
  {
    type: "internal",
    label: "Internal",
    description: "Track progress on a task or workspace condition.",
    icon: <Target size={18} strokeWidth={1.6} />,
  },
];

/**
 * Connector required for an "advanced" variant of a given sentinel type.
 * Neither is required for basic creation — only surfaced as an optional upgrade.
 */
const CONNECTOR_BY_TYPE: Record<SentinelType, { provider: string; label: string } | null> = {
  web: { provider: "bright_data", label: "Bright Data" },
  email: { provider: "gmail", label: "Gmail" },
  internal: null,
};

export default function NewSentinelModal({ open, onClose, onCreated }: NewSentinelModalProps) {
  const { user } = useContext(AuthContext);

  const [step, setStep] = useState<1 | 2>(1);
  const [type, setType] = useState<SentinelType | null>(null);
  const [connectedProviders, setConnectedProviders] = useState<Set<string>>(new Set());

  // Step 2 fields
  const [conditionText, setConditionText] = useState("");
  const [target, setTarget] = useState("");
  const [frequencyMin, setFrequencyMin] = useState(360);
  const [useAdvanced, setUseAdvanced] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase
      .from("sybil_oauth_connections")
      .select("provider, status")
      .eq("status", "connected")
      .then(({ data }) => {
        setConnectedProviders(new Set((data ?? []).map((c) => c.provider)));
      });
  }, [open]);

  function reset() {
    setStep(1);
    setType(null);
    setConditionText("");
    setTarget("");
    setFrequencyMin(360);
    setUseAdvanced(false);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function selectType(t: SentinelType) {
    setType(t);
    setStep(2);
  }

  async function handleSubmit() {
    if (!type || !user) return;

    let finalConditionText = conditionText;
    if (type === "web") {
      finalConditionText = conditionText || `Watch ${target} for changes`;
    } else if (type === "email") {
      finalConditionText = conditionText || `Alert if ${target} stays silent`;
    }

    if (!finalConditionText.trim()) {
      setError("Please fill in the required field.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const { error: err } = await supabase.from("sybil_sentinels").insert({
      owner_id: user.id,
      condition_text: finalConditionText,
      type,
      status: "active",
      frequency_min: frequencyMin,
      config: { target: target || null },
    });

    setSubmitting(false);

    if (err) {
      setError(
        err.message.includes("row-level security policy")
          ? "You've reached the limit of 3 sentinels. Delete one to create a new one."
          : err.message,
      );
      return;
    }

    onCreated();
    handleClose();
  }

  const connector = type ? CONNECTOR_BY_TYPE[type] : null;
  const connectorConnected = connector ? connectedProviders.has(connector.provider) : true;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={step === 1 ? "New sentinel" : `New sentinel · ${TYPE_OPTIONS.find((o) => o.type === type)?.label}`}
    >
      {step === 1 && (
        <div className="flex flex-col gap-2.5">
          <p className="text-sm text-fg-muted mb-1">What should this sentinel watch?</p>
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.type}
              onClick={() => selectType(opt.type)}
              className="flex items-center gap-3.5 text-left bg-bg-surface border border-fg-subtle/20 rounded-lg px-4 py-3.5 hover:border-sine-indigo/50 hover:bg-sine-indigo/5 transition-colors duration-150 cursor-pointer"
            >
              <span className="shrink-0 w-9 h-9 rounded-lg bg-fg-subtle/10 flex items-center justify-center text-sine-indigo">
                {opt.icon}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-fg-primary">{opt.label}</span>
                <span className="block text-xs text-fg-subtle mt-0.5">{opt.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {step === 2 && type && (
        <div className="flex flex-col gap-4">
          {type === "web" && (
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1.5">
                URL to monitor
              </label>
              <input
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="https://example.com/pricing"
                className="w-full px-3 py-2 rounded-md border border-fg-subtle/25 bg-bg-base text-fg-primary text-sm font-mono placeholder:text-fg-subtle focus:outline-none focus:border-sine-indigo/60"
              />
            </div>
          )}

          {type === "email" && (
            <>
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1.5">
                  Contact or thread reference
                </label>
                <input
                  type="text"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="e.g. rossi@client.com"
                  className="w-full px-3 py-2 rounded-md border border-fg-subtle/25 bg-bg-base text-fg-primary text-sm font-mono placeholder:text-fg-subtle focus:outline-none focus:border-sine-indigo/60"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1.5">
                  Condition
                </label>
                <input
                  type="text"
                  value={conditionText}
                  onChange={(e) => setConditionText(e.target.value)}
                  placeholder="Alert me if they don't reply within 4 days"
                  className="w-full px-3 py-2 rounded-md border border-fg-subtle/25 bg-bg-base text-fg-primary text-sm placeholder:text-fg-subtle focus:outline-none focus:border-sine-indigo/60"
                />
              </div>
            </>
          )}

          {type === "internal" && (
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1.5">
                What should Sybil watch?
              </label>
              <input
                type="text"
                value={conditionText}
                onChange={(e) => setConditionText(e.target.value)}
                placeholder="Alert me when the Aurora project moves past 80%"
                className="w-full px-3 py-2 rounded-md border border-fg-subtle/25 bg-bg-base text-fg-primary text-sm placeholder:text-fg-subtle focus:outline-none focus:border-sine-indigo/60"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1.5">
              Check every
            </label>
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

          {connector && (
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={useAdvanced}
                onChange={(e) => setUseAdvanced(e.target.checked)}
                className="mt-0.5 accent-sine-indigo"
              />
              <span className="text-xs text-fg-muted">
                Use {connector.label} for {type === "web" ? "advanced scraping" : "direct inbox reading"}
              </span>
            </label>
          )}

          {connector && useAdvanced && !connectorConnected && (
            <div className="bg-warning/10 border border-warning/30 rounded-lg px-3.5 py-3 text-xs text-fg-primary">
              Connect {connector.label} to use this option.{" "}
              <Link
                to="/settings#integrations"
                onClick={handleClose}
                className="font-semibold text-warning hover:text-warning/80"
              >
                Go to Settings → Integrations
              </Link>
            </div>
          )}

          {error && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg px-3.5 py-2.5 text-xs text-fg-primary">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between mt-1">
            <button
              onClick={() => setStep(1)}
              className="text-xs font-medium text-fg-subtle hover:text-fg-primary transition-colors duration-150 cursor-pointer"
            >
              ← Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-success text-bg-base text-sm font-semibold hover:bg-success/90 transition-colors duration-150 cursor-pointer disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create sentinel"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
