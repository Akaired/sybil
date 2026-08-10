import { useContext, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { AuthContext } from "../contexts/AuthContext";
import {
  preDeleteCheck,
  deleteAccount,
  AccountManageError,
  type WorkspaceRequiringChoice,
  type DeleteChoice,
} from "../lib/account";
import Modal from "./Modal";

type Step = "checking" | "check-error" | "workspaces" | "confirm" | "deleting";

interface WorkspaceChoiceState {
  mode: "transfer" | "delete" | null;
  new_owner_user_id?: string;
}

const btnSecondary =
  "text-[13px] text-fg-subtle hover:text-fg-primary transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none cursor-pointer";
const btnDanger =
  "inline-flex items-center gap-2 bg-danger text-white text-[13px] font-semibold rounded-md px-4 py-2 hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

export default function DeleteAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, signOutAfterDeletion } = useContext(AuthContext);

  const [step, setStep] = useState<Step>("checking");
  const [checkError, setCheckError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRequiringChoice[]>([]);
  const [choices, setChoices] = useState<Record<string, WorkspaceChoiceState>>({});
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function runCheck() {
    setStep("checking");
    setCheckError(null);
    preDeleteCheck()
      .then((res) => {
        setWorkspaces(res.requires_choice);
        const initial: Record<string, WorkspaceChoiceState> = {};
        for (const w of res.requires_choice) initial[w.workspace_id] = { mode: null };
        setChoices(initial);
        setStep(res.requires_choice.length === 0 ? "confirm" : "workspaces");
      })
      .catch((err) => {
        setCheckError(
          err instanceof AccountManageError ? err.message : "Couldn't check your workspaces. Please try again.",
        );
        setStep("check-error");
      });
  }

  // Reset to a clean run every time the dialog opens — a previous attempt
  // (choices, typed email, a stale error) must never leak into a fresh open.
  useEffect(() => {
    if (!open) return;
    setWorkspaces([]);
    setChoices({});
    setConfirmEmail("");
    setDeleteError(null);
    runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function setMode(workspaceId: string, mode: "transfer" | "delete") {
    setChoices((prev) => ({
      ...prev,
      [workspaceId]: { mode, new_owner_user_id: mode === "delete" ? undefined : prev[workspaceId]?.new_owner_user_id },
    }));
  }

  function setNewOwner(workspaceId: string, newOwnerUserId: string) {
    setChoices((prev) => ({ ...prev, [workspaceId]: { mode: "transfer", new_owner_user_id: newOwnerUserId } }));
  }

  const allChoicesValid = workspaces.every((w) => {
    const c = choices[w.workspace_id];
    if (!c || !c.mode) return false;
    return c.mode === "delete" || !!c.new_owner_user_id;
  });

  const userEmail = (user?.email ?? "").trim().toLowerCase();
  const emailMatches = userEmail.length > 0 && confirmEmail.trim().toLowerCase() === userEmail;

  async function handleDelete() {
    setDeleteError(null);
    setStep("deleting");
    try {
      const payload: DeleteChoice[] = workspaces.map((w) => {
        const c = choices[w.workspace_id]!;
        return c.mode === "transfer"
          ? { workspace_id: w.workspace_id, mode: "transfer", new_owner_user_id: c.new_owner_user_id! }
          : { workspace_id: w.workspace_id, mode: "delete" };
      });
      await deleteAccount(payload);
      // Page unloads via a hard redirect inside signOutAfterDeletion — no
      // further local state updates needed (or safe to make) after this.
      await signOutAfterDeletion();
    } catch (err) {
      setDeleteError(
        err instanceof AccountManageError ? err.message : "Couldn't delete your account. Please try again.",
      );
      // Back to confirm, never left sitting on the non-closable "deleting"
      // step after a failure — the user must be able to retry or cancel.
      setStep("confirm");
    }
  }

  const closable = step !== "deleting";

  return (
    <Modal
      open={open}
      onClose={() => {
        if (closable) onClose();
      }}
      title="Delete your account"
      maxWidth="max-w-lg"
      footer={Footer()}
    >
      {Body()}
    </Modal>
  );

  function Body() {
    if (step === "checking") {
      return (
        <div className="flex items-center gap-3 text-fg-muted py-6 justify-center">
          <Loader2 size={16} strokeWidth={2.2} className="animate-spin" />
          <span className="text-sm">Checking your workspaces…</span>
        </div>
      );
    }

    if (step === "check-error") {
      return (
        <div className="py-2">
          <p className="text-[13.5px] text-danger flex items-start gap-1.5">
            <AlertTriangle size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
            {checkError}
          </p>
        </div>
      );
    }

    if (step === "workspaces") {
      return (
        <div className="space-y-5">
          <p className="text-[13px] text-fg-subtle">
            You're the only owner of {workspaces.length === 1 ? "this workspace" : "these workspaces"}. Choose what
            happens to {workspaces.length === 1 ? "it" : "each of them"} before you can continue.
          </p>
          {workspaces.map((w) => {
            const c = choices[w.workspace_id] ?? { mode: null };
            return (
              <div key={w.workspace_id} className="border border-fg-subtle/20 rounded-lg px-4 py-3.5">
                <p className="text-sm font-medium text-fg-primary mb-3">{w.workspace_name}</p>

                <label className="flex items-start gap-2.5 cursor-pointer mb-2.5">
                  <input
                    type="radio"
                    name={`mode-${w.workspace_id}`}
                    checked={c.mode === "transfer"}
                    onChange={() => setMode(w.workspace_id, "transfer")}
                    disabled={w.members.length === 0}
                    className="mt-0.5 accent-warning"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-[13.5px] text-fg-primary">Transfer to another member</span>
                    {w.members.length === 0 ? (
                      <p className="text-[12px] text-fg-subtle mt-0.5">No other members — transfer isn't available.</p>
                    ) : (
                      c.mode === "transfer" && (
                        <select
                          value={c.new_owner_user_id ?? ""}
                          onChange={(e) => setNewOwner(w.workspace_id, e.target.value)}
                          className="mt-2 w-full bg-bg-base border border-fg-subtle/25 rounded-md px-2.5 py-1.5 text-[13px] text-fg-primary cursor-pointer"
                        >
                          <option value="" disabled>
                            Choose a member…
                          </option>
                          {w.members.map((m) => (
                            <option key={m.user_id} value={m.user_id}>
                              {m.display_name} — {m.email}
                            </option>
                          ))}
                        </select>
                      )
                    )}
                  </div>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name={`mode-${w.workspace_id}`}
                    checked={c.mode === "delete"}
                    onChange={() => setMode(w.workspace_id, "delete")}
                    className="mt-0.5 accent-danger"
                  />
                  <div>
                    <span className="text-[13.5px] text-fg-primary">Delete the workspace and all its data</span>
                    <p className="text-[12px] text-fg-subtle mt-0.5">
                      Irreversible — this also removes access for every other member of{" "}
                      {w.members.length > 0 ? "this workspace" : "it"}.
                    </p>
                  </div>
                </label>
              </div>
            );
          })}
        </div>
      );
    }

    if (step === "confirm" || step === "deleting") {
      return (
        <div className="space-y-4">
          <div>
            <p className="text-[13px] text-fg-subtle mb-2">This will permanently delete:</p>
            <ul className="space-y-1.5">
              <li className="flex items-start gap-2 text-[13.5px] text-fg-primary">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-fg-subtle shrink-0" />
                Your profile, chats, sentinels, and connected accounts.
              </li>
              {workspaces.map((w) => {
                const c = choices[w.workspace_id];
                const member = c?.new_owner_user_id
                  ? w.members.find((m) => m.user_id === c.new_owner_user_id)
                  : null;
                return (
                  <li key={w.workspace_id} className="flex items-start gap-2 text-[13.5px] text-fg-primary">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-fg-subtle shrink-0" />
                    {c?.mode === "transfer" ? (
                      <span>
                        <strong className="font-medium">{w.workspace_name}</strong> will be transferred to{" "}
                        <strong className="font-medium">{member?.display_name ?? "the selected member"}</strong> (
                        {member?.email}).
                      </span>
                    ) : (
                      <span>
                        <strong className="font-medium">{w.workspace_name}</strong> and all its data will be
                        permanently deleted, for every member.
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <p className="text-[13px] text-danger font-medium">This can't be undone.</p>

          <div>
            <label className="block text-[11.5px] font-semibold uppercase tracking-wide text-fg-subtle mb-1.5">
              Type your email ({user?.email}) to confirm
            </label>
            <input
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              disabled={step === "deleting"}
              placeholder={user?.email ?? ""}
              autoComplete="off"
              className="w-full bg-bg-base border border-fg-subtle/25 rounded-md px-3 py-2 text-[13.5px] text-fg-primary placeholder:text-fg-subtle focus:outline-none focus:border-danger/50 disabled:opacity-60"
            />
          </div>

          {step === "deleting" && (
            <p className="flex items-center gap-2 text-[13px] text-fg-muted">
              <Loader2 size={14} strokeWidth={2.2} className="animate-spin" />
              Deleting your account — don't close this window…
            </p>
          )}

          {deleteError && (
            <p className="text-[13px] text-danger flex items-start gap-1.5">
              <AlertTriangle size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
              {deleteError}
            </p>
          )}
        </div>
      );
    }

    return null;
  }

  function Footer() {
    if (step === "checking" || step === "deleting") return null;

    if (step === "check-error") {
      return (
        <>
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button type="button" onClick={runCheck} className={btnDanger}>
            Retry
          </button>
        </>
      );
    }

    if (step === "workspaces") {
      return (
        <>
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => setStep("confirm")}
            disabled={!allChoicesValid}
            className={btnDanger}
          >
            Continue
          </button>
        </>
      );
    }

    // confirm
    return (
      <>
        <button type="button" onClick={onClose} className={btnSecondary}>
          Cancel
        </button>
        {workspaces.length > 0 && (
          <button type="button" onClick={() => setStep("workspaces")} className={btnSecondary}>
            Back
          </button>
        )}
        <button type="button" onClick={handleDelete} disabled={!emailMatches} className={btnDanger}>
          <Trash2 size={14} strokeWidth={2.2} />
          Delete my account permanently
        </button>
      </>
    );
  }
}
