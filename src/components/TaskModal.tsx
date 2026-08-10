import { useEffect, useState } from "react";
import { ArrowLeft, Save, Trash2, RefreshCw, X } from "lucide-react";
import Modal from "./Modal";
import {
  TASK_STATUSES,
  TASK_PRIORITIES,
  labelColor,
  type Task,
  type TaskStatus,
  type TaskPriority,
  type WorkspaceMember,
} from "../lib/tasks";

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  doing: "Doing",
  done: "Done",
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export interface TaskModalSubmit {
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  labels: string[];
  assignee_id: string | null;
}

interface TaskModalProps {
  open: boolean;
  task: Task | null; // null = create mode
  defaultStatus: TaskStatus;
  members: WorkspaceMember[];
  onClose: () => void;
  onSubmit: (values: TaskModalSubmit) => Promise<void>;
  onDelete?: () => Promise<void>;
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export default function TaskModal({ open, task, defaultStatus, members, onClose, onSubmit, onDelete }: TaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("backlog");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [labelDraft, setLabelDraft] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setStatus(task?.status ?? defaultStatus);
    setPriority(task?.priority ?? "medium");
    setDueDate(toDateInputValue(task?.due_date ?? null));
    setLabels(task?.labels ?? []);
    setLabelDraft("");
    setAssigneeId(task?.assignee_id ?? null);
    setError(null);
    setConfirmingDelete(false);
  }, [open, task, defaultStatus]);

  if (!open) return null;

  function addLabelFromDraft() {
    const trimmed = labelDraft.trim();
    if (trimmed && !labels.includes(trimmed)) setLabels((prev) => [...prev, trimmed]);
    setLabelDraft("");
  }

  function removeLabel(label: string) {
    setLabels((prev) => prev.filter((l) => l !== label));
  }

  async function handleSubmit() {
    if (!title.trim()) {
      setError("Title can't be empty.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        labels,
        assignee_id: assigneeId,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the task.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete the task.");
      setDeleting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={task ? "Edit task" : "New task"}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1.5">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to get done?"
            className="w-full px-3 py-2 rounded-md border border-fg-subtle/25 bg-bg-base text-fg-primary text-sm placeholder:text-fg-subtle focus:outline-none focus:border-sine-indigo/60"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1.5">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Optional details"
            className="w-full resize-none px-3 py-2 rounded-md border border-fg-subtle/25 bg-bg-base text-fg-primary text-sm placeholder:text-fg-subtle focus:outline-none focus:border-sine-indigo/60"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1.5">Status</label>
          <div className="flex gap-1.5 flex-wrap">
            {TASK_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 cursor-pointer ${
                  status === s
                    ? "bg-sine-indigo/18 text-sine-indigo border border-sine-indigo/40"
                    : "bg-bg-surface text-fg-muted border border-fg-subtle/20 hover:text-fg-primary"
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1.5">Priority</label>
          <div className="flex gap-1.5 flex-wrap">
            {TASK_PRIORITIES.map((p) => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 cursor-pointer ${
                  priority === p
                    ? "bg-sine-indigo/18 text-sine-indigo border border-sine-indigo/40"
                    : "bg-bg-surface text-fg-muted border border-fg-subtle/20 hover:text-fg-primary"
                }`}
              >
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
        </div>

        {members.length > 1 && (
          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1.5">Assigned to</label>
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setAssigneeId(null)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 cursor-pointer ${
                  assigneeId === null
                    ? "bg-sine-indigo/18 text-sine-indigo border border-sine-indigo/40"
                    : "bg-bg-surface text-fg-muted border border-fg-subtle/20 hover:text-fg-primary"
                }`}
              >
                Unassigned
              </button>
              {members.map((m) => (
                <button
                  key={m.userId}
                  onClick={() => setAssigneeId(m.userId)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 cursor-pointer ${
                    assigneeId === m.userId
                      ? "bg-sine-indigo/18 text-sine-indigo border border-sine-indigo/40"
                      : "bg-bg-surface text-fg-muted border border-fg-subtle/20 hover:text-fg-primary"
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1.5">Due date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-fg-subtle/25 bg-bg-base text-fg-primary text-sm focus:outline-none focus:border-sine-indigo/60"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1.5">Labels</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {labels.map((label) => (
              <span
                key={label}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border"
                style={{
                  color: labelColor(label),
                  borderColor: `color-mix(in srgb, ${labelColor(label)} 35%, transparent)`,
                  background: `color-mix(in srgb, ${labelColor(label)} 12%, transparent)`,
                }}
              >
                {label}
                <button onClick={() => removeLabel(label)} className="cursor-pointer">
                  <X size={10} strokeWidth={2.5} />
                </button>
              </span>
            ))}
          </div>
          <input
            type="text"
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLabelFromDraft();
              }
            }}
            onBlur={addLabelFromDraft}
            placeholder="Type a label and press Enter"
            className="w-full px-3 py-2 rounded-md border border-fg-subtle/25 bg-bg-base text-fg-primary text-sm placeholder:text-fg-subtle focus:outline-none focus:border-sine-indigo/60"
          />
        </div>

        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg px-3.5 py-2.5 text-xs text-fg-primary">
            {error}
          </div>
        )}

        {onDelete && <div className="h-px bg-fg-subtle/15" />}

        {onDelete && confirmingDelete ? (
          <div className="bg-danger/10 border border-danger/30 rounded-lg px-3.5 py-3 flex items-center justify-between gap-3">
            <span className="text-xs text-fg-primary">Delete this task permanently?</span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setConfirmingDelete(false)}
                title="Cancel"
                className="flex items-center justify-center w-8 h-8 rounded-md border border-fg-subtle/25 text-fg-muted hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 cursor-pointer"
              >
                <ArrowLeft size={14} strokeWidth={1.8} />
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                title="Delete"
                className="flex items-center justify-center w-8 h-8 rounded-md bg-danger text-bg-base hover:bg-danger/90 transition-colors duration-150 cursor-pointer disabled:opacity-50"
              >
                {deleting ? <RefreshCw size={14} strokeWidth={1.8} className="animate-spin" /> : <Trash2 size={14} strokeWidth={1.8} />}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between mt-1">
            {onDelete ? (
              <button
                onClick={() => setConfirmingDelete(true)}
                title="Delete task"
                className="flex items-center justify-center w-9 h-9 rounded-lg border border-danger/30 text-danger hover:bg-danger/10 transition-colors duration-150 cursor-pointer"
              >
                <Trash2 size={16} strokeWidth={1.8} />
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                title="Cancel"
                className="flex items-center justify-center w-9 h-9 rounded-lg border border-fg-subtle/25 text-fg-muted hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 cursor-pointer"
              >
                <ArrowLeft size={16} strokeWidth={1.8} />
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                title={task ? "Save changes" : "Create task"}
                className="flex items-center justify-center w-9 h-9 rounded-lg bg-success text-bg-base hover:bg-success/90 transition-colors duration-150 cursor-pointer disabled:opacity-50"
              >
                {submitting ? <RefreshCw size={16} strokeWidth={1.8} className="animate-spin" /> : <Save size={16} strokeWidth={1.8} />}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
