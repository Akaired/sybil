import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Check, KeyRound, Loader2, Mail, ShieldCheck, User } from "lucide-react";
import { AuthContext } from "../../contexts/AuthContext";
import { supabase } from "../../config/supabase";
import { getDisplayName } from "../../utils/displayName";
import { deactivateAccount, AccountManageError } from "../../lib/account";
import SettingsSection from "../../components/settings/SettingsSection";
import ComingSoonBadge from "../../components/settings/ComingSoonBadge";
import Modal from "../../components/Modal";
import DeleteAccountDialog from "../../components/DeleteAccountDialog";
import { DEMO_ACCOUNT_EMAIL } from "../../lib/demoLimit";

const NAME_MAX_LENGTH = 50;
const PASSWORD_MIN_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEMO_ACCOUNT_MESSAGE = "This is the shared demo account — profile, password, and account settings are locked.";

/** Never surface a raw Supabase/Postgrest error string to the user. */
function mapAuthError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const lower = raw.toLowerCase();
  if (lower.includes("invalid login credentials")) return "Current password is incorrect.";
  if (lower.includes("should be at least") || lower.includes("at least 6") || lower.includes("at least 8"))
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (lower.includes("should be different") || lower.includes("same password") || lower.includes("same_password"))
    return "New password must be different from your current password.";
  if (lower.includes("already registered") || lower.includes("already exists") || lower.includes("already been registered"))
    return "That email is already in use by another account.";
  if (lower.includes("rate limit") || lower.includes("too many"))
    return "Too many attempts — please wait a moment and try again.";
  if (lower.includes("network")) return "Network error — check your connection and try again.";
  return fallback;
}

/** Small inline success confirmation that clears itself after a few seconds. */
function useAutoDismiss(value: string | null, setValue: (v: string | null) => void, ms = 3500) {
  useEffect(() => {
    if (!value) return;
    const t = setTimeout(() => setValue(null), ms);
    return () => clearTimeout(t);
  }, [value, setValue, ms]);
}

const inputClass =
  "w-full bg-bg-base border border-fg-subtle/25 rounded-md px-3 py-2 text-[13.5px] text-fg-primary placeholder:text-fg-subtle focus:outline-none focus:border-fg-subtle/50 disabled:opacity-60 disabled:cursor-not-allowed";
const labelClass = "block text-[11.5px] font-semibold uppercase tracking-wide text-fg-subtle mb-1.5";

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mt-2 text-[12.5px] text-danger flex items-center gap-1.5"><AlertTriangle size={13} strokeWidth={2} className="shrink-0" />{message}</p>;
}

function SuccessText({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mt-2 text-[12.5px] text-success flex items-center gap-1.5"><Check size={13} strokeWidth={2} className="shrink-0" />{message}</p>;
}

function SaveButton({ loading, disabled, children }: { loading: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="inline-flex items-center gap-2 bg-warning text-bg-base text-[13px] font-semibold rounded-md px-4 py-2 hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
    >
      {loading && <Loader2 size={14} strokeWidth={2.2} className="animate-spin" />}
      {children}
    </button>
  );
}

// ── Profile ──────────────────────────────────────────────────────────────

function ProfileSection() {
  const { user, profile, refreshProfile } = useContext(AuthContext);
  const isDemo = user?.email === DEMO_ACCOUNT_EMAIL;
  const currentName = getDisplayName(user, profile);
  const [name, setName] = useState(currentName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  useAutoDismiss(success, setSuccess);

  // Keep the field in sync if the profile loads/changes after this section
  // has already mounted (e.g. slow initial fetch).
  useEffect(() => {
    setName(currentName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentName]);

  const trimmed = name.trim();
  const validationError =
    trimmed.length === 0
      ? "Display name can't be empty."
      : trimmed.length > NAME_MAX_LENGTH
        ? `Display name must be ${NAME_MAX_LENGTH} characters or fewer.`
        : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || validationError || !user || isDemo) return;
    setError(null);
    setLoading(true);
    try {
      const { error: dbError } = await supabase
        .from("sybil_profiles")
        .update({ display_name: trimmed })
        .eq("user_id", user.id);
      if (dbError) throw dbError;
      await refreshProfile();
      setSuccess("Display name updated.");
    } catch (err) {
      setError(mapAuthError(err, "Couldn't save your display name. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SettingsSection title="Profile" description="How your name appears across Sybil.">
      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div>
          <label className={labelClass}>Display name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX_LENGTH + 20}
            placeholder="Your name"
            className={inputClass}
            disabled={isDemo}
          />
          <ErrorText message={name !== currentName ? validationError : null} />
        </div>
        <div>
          <label className={labelClass}>Email</label>
          <input value={user?.email ?? ""} disabled readOnly className={inputClass} />
        </div>
        <div className="flex items-center gap-3">
          <SaveButton loading={loading} disabled={isDemo || !!validationError || trimmed === currentName}>
            Save changes
          </SaveButton>
          <SuccessText message={success} />
        </div>
        {isDemo && <ErrorText message={DEMO_ACCOUNT_MESSAGE} />}
        <ErrorText message={error} />
      </form>
    </SettingsSection>
  );
}

// ── Email ────────────────────────────────────────────────────────────────

function EmailSection() {
  const { user } = useContext(AuthContext);
  const isDemo = user?.email === DEMO_ACCOUNT_EMAIL;
  const identities = user?.identities ?? [];
  const isGoogleOnly = identities.length > 0 && identities.every((i) => i.provider === "google");

  const [newEmail, setNewEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(user?.new_email ?? null);

  const trimmedNew = newEmail.trim();
  const formatError =
    trimmedNew.length === 0
      ? null
      : !EMAIL_RE.test(trimmedNew)
        ? "Enter a valid email address."
        : trimmedNew.toLowerCase() === (user?.email ?? "").toLowerCase()
          ? "That's already your current email."
          : confirmEmail && confirmEmail.trim() !== trimmedNew
            ? "Email addresses don't match."
            : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || formatError || !trimmedNew || confirmEmail.trim() !== trimmedNew || isDemo) return;
    setError(null);
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ email: trimmedNew });
      if (updateError) throw updateError;
      setPendingEmail(trimmedNew);
      setNewEmail("");
      setConfirmEmail("");
    } catch (err) {
      setError(mapAuthError(err, "Couldn't start the email change. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  if (isGoogleOnly) {
    return (
      <SettingsSection title="Email">
        <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-5 py-4 flex items-start gap-3">
          <Mail size={18} strokeWidth={1.6} className="text-fg-subtle shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-fg-primary">{user?.email}</p>
            <p className="text-[13px] text-fg-subtle mt-0.5">
              Your email is managed by the Google account connected to Sybil. Change it there to update it here.
            </p>
          </div>
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Email">
      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div>
          <label className={labelClass}>New email</label>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="name@example.com"
            className={inputClass}
            disabled={isDemo}
          />
        </div>
        <div>
          <label className={labelClass}>Confirm new email</label>
          <input
            type="email"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            placeholder="name@example.com"
            className={inputClass}
            disabled={isDemo}
          />
        </div>
        <p className="text-[12.5px] text-fg-subtle">
          Confirmation links will be sent to both your current address ({user?.email}) and the new one.
          The change only takes effect once you confirm from both inboxes.
        </p>
        <ErrorText message={formatError} />
        <div className="flex items-center gap-3">
          <SaveButton
            loading={loading}
            disabled={isDemo || !!formatError || !trimmedNew || confirmEmail.trim() !== trimmedNew}
          >
            Change email
          </SaveButton>
        </div>
        {isDemo && <ErrorText message={DEMO_ACCOUNT_MESSAGE} />}
        <ErrorText message={error} />
        {pendingEmail && (
          <p className="text-[12.5px] text-fg-muted bg-bg-elevated border border-fg-subtle/20 rounded-md px-3 py-2.5">
            Confirmation pending for <span className="text-fg-primary font-medium">{pendingEmail}</span> — check both
            inboxes to complete the change.
          </p>
        )}
      </form>
    </SettingsSection>
  );
}

// ── Password ─────────────────────────────────────────────────────────────

function PasswordSection() {
  const { user } = useContext(AuthContext);
  const isDemo = user?.email === DEMO_ACCOUNT_EMAIL;
  const identities = user?.identities ?? [];
  // Default to "has a password" when identities aren't available yet — the
  // common case, and the safer default (asking for a current password that
  // turns out not to exist just fails the reauth step below, rather than
  // silently skipping it for someone who actually has one).
  const hasPassword = identities.length === 0 || identities.some((i) => i.provider === "email");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  useAutoDismiss(success, setSuccess);

  const validationError =
    newPassword.length > 0 && newPassword.length < PASSWORD_MIN_LENGTH
      ? `New password must be at least ${PASSWORD_MIN_LENGTH} characters.`
      : hasPassword && newPassword.length > 0 && newPassword === currentPassword
        ? "New password must be different from your current password."
        : confirmPassword.length > 0 && confirmPassword !== newPassword
          ? "Passwords don't match."
          : null;

  const canSubmit =
    !isDemo &&
    newPassword.length >= PASSWORD_MIN_LENGTH &&
    confirmPassword === newPassword &&
    !validationError &&
    (!hasPassword || currentPassword.length > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || !canSubmit || !user?.email) return;
    setError(null);
    setLoading(true);
    try {
      if (hasPassword) {
        // supabase.auth.updateUser({ password }) does NOT verify the caller
        // actually knows the current password — anyone holding a live
        // session could otherwise change it. Reauthenticate explicitly
        // first so a stolen/left-open session can't be used to lock the
        // real owner out.
        const { error: reauthError } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: currentPassword,
        });
        if (reauthError) {
          setError("Current password is incorrect.");
          setLoading(false);
          return;
        }
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(hasPassword ? "Password updated." : "Password set.");
    } catch (err) {
      setError(mapAuthError(err, "Couldn't update your password. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SettingsSection title="Password">
      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        {hasPassword && (
          <div>
            <label className={labelClass}>Current password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              className={inputClass}
              autoComplete="current-password"
              disabled={isDemo}
            />
          </div>
        )}
        <div>
          <label className={labelClass}>New password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
            autoComplete="new-password"
            disabled={isDemo}
          />
        </div>
        <div>
          <label className={labelClass}>Confirm new password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
            autoComplete="new-password"
            disabled={isDemo}
          />
        </div>
        <ErrorText message={validationError} />
        <div className="flex items-center gap-3">
          <SaveButton loading={loading} disabled={!canSubmit}>
            <KeyRound size={14} strokeWidth={2.2} />
            {hasPassword ? "Update password" : "Set password"}
          </SaveButton>
          <SuccessText message={success} />
        </div>
        {isDemo && <ErrorText message={DEMO_ACCOUNT_MESSAGE} />}
        <ErrorText message={error} />
      </form>
    </SettingsSection>
  );
}

// ── Two-factor authentication ───────────────────────────────────────────

function TwoFactorSection() {
  return (
    <SettingsSection title="Two-factor authentication" badge={<ComingSoonBadge />}>
      <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-5 py-4 flex items-center gap-4">
        <div className="w-9 h-9 rounded-lg bg-fg-subtle/10 flex items-center justify-center text-fg-muted shrink-0">
          <ShieldCheck size={18} strokeWidth={1.6} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] text-fg-subtle">
            Add a temporary code from an authenticator app on top of your password.
          </p>
          <p className="text-[13.5px] text-fg-subtle mt-0.5">
            You'll be asked for it, in addition to your password, each time you sign in.
          </p>
        </div>
        <button
          type="button"
          disabled
          aria-label="Enable two-factor authentication (coming soon)"
          className="relative w-9 h-5 rounded-full bg-fg-subtle/20 cursor-not-allowed shrink-0"
        >
          <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-fg-subtle/60" />
        </button>
      </div>
    </SettingsSection>
  );
}

// ── Danger zone ──────────────────────────────────────────────────────────

const DEACTIVATE_CONSEQUENCES = [
  "All your sentinels stop monitoring immediately.",
  "The agent stops taking any action on your behalf.",
  "Your data stays intact — nothing is deleted yet.",
  "You have 30 days to reactivate before the account is permanently deleted.",
];

function DangerZone() {
  const { user, refreshProfile } = useContext(AuthContext);
  const isDemo = user?.email === DEMO_ACCOUNT_EMAIL;
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  async function handleDeactivate() {
    if (isDemo) return;
    setDeactivating(true);
    setError(null);
    try {
      await deactivateAccount();
      // Pull the fresh status/deactivated_at into context before navigating —
      // the lock screen reads profile.deactivated_at to compute its countdown.
      await refreshProfile();
      navigate("/account-deactivated", { replace: true });
    } catch (err) {
      const message =
        err instanceof AccountManageError ? err.message : "Couldn't deactivate your account. Please try again.";
      setError(message);
      setDeactivating(false);
    }
  }

  return (
    <section className="mb-8 border border-danger/25 rounded-lg px-5 py-5 bg-danger/[0.03]">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={15} strokeWidth={2} className="text-danger" />
        <h2 className="text-sm font-medium text-fg-primary">Danger zone</h2>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4 border-b border-fg-subtle/10 pb-3">
          <div>
            <p className="text-sm text-fg-primary font-medium">Deactivate account</p>
            <p className="text-[13px] text-fg-subtle mt-0.5">
              Suspends your account. You can reactivate it within 30 days before it's permanently removed.
            </p>
          </div>
          <button
            type="button"
            disabled={isDemo}
            onClick={() => {
              setError(null);
              setConfirmOpen(true);
            }}
            className="shrink-0 border border-danger/40 text-danger text-[13px] font-medium rounded-md px-4 py-2 hover:bg-danger/10 transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            Deactivate
          </button>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-fg-primary font-medium">Delete account</p>
            <p className="text-[13px] text-fg-subtle mt-0.5">Permanently deletes your account. This can't be undone.</p>
          </div>
          <button
            type="button"
            disabled={isDemo}
            onClick={() => setDeleteDialogOpen(true)}
            className="shrink-0 border border-danger/40 text-danger text-[13px] font-medium rounded-md px-4 py-2 hover:bg-danger/10 transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            Delete
          </button>
        </div>
        {isDemo && <p className="text-[12.5px] text-fg-subtle pt-1">{DEMO_ACCOUNT_MESSAGE}</p>}
      </div>

      {!isDemo && <DeleteAccountDialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} />}

      <Modal
        open={confirmOpen}
        onClose={() => {
          if (!deactivating) setConfirmOpen(false);
        }}
        title="Deactivate your account?"
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={deactivating}
              className="text-[13px] text-fg-subtle hover:text-fg-primary transition-colors duration-150 disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeactivate}
              disabled={deactivating}
              className="inline-flex items-center gap-2 bg-danger text-white text-[13px] font-semibold rounded-md px-4 py-2 hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 cursor-pointer"
            >
              {deactivating && <Loader2 size={14} strokeWidth={2.2} className="animate-spin" />}
              Yes, deactivate
            </button>
          </>
        }
      >
        <ul className="space-y-2">
          {DEACTIVATE_CONSEQUENCES.map((point) => (
            <li key={point} className="flex items-start gap-2 text-[13.5px] text-fg-subtle">
              <span className="mt-1.5 w-1 h-1 rounded-full bg-fg-subtle shrink-0" />
              {point}
            </li>
          ))}
        </ul>
        <ErrorText message={error} />
      </Modal>
    </section>
  );
}

export default function SettingsAccount() {
  const { user } = useContext(AuthContext);
  if (!user) {
    return (
      <div className="border border-dashed border-fg-subtle/25 rounded-lg px-6 py-14 flex flex-col items-center text-center">
        <div className="w-10 h-10 rounded-full bg-fg-subtle/10 flex items-center justify-center text-fg-subtle mb-3">
          <User size={18} strokeWidth={1.6} />
        </div>
        <p className="text-sm font-medium text-fg-primary">Loading account…</p>
      </div>
    );
  }

  return (
    <div>
      <ProfileSection />
      <EmailSection />
      <PasswordSection />
      <TwoFactorSection />
      <DangerZone />
    </div>
  );
}
