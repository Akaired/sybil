import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Pencil, Trash2, X, Check, RefreshCw, SatelliteDish, CalendarClock } from "lucide-react";
import type { Task, TaskPriority } from "../lib/tasks";
import { labelColor } from "../lib/tasks";

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  low: "text-fg-subtle border-fg-subtle/25 bg-fg-subtle/5",
  medium: "text-sine-cyan border-sine-cyan/30 bg-sine-cyan/10",
  high: "text-sine-amber border-sine-amber/30 bg-sine-amber/10",
  urgent: "text-sine-signal border-sine-signal/30 bg-sine-signal/10",
};

function dueDateInfo(dueDate: string | null, done: boolean): { label: string; className: string } | null {
  if (!dueDate) return null;
  const date = new Date(dueDate);
  const diffMs = date.getTime() - Date.now();
  const diffDays = Math.ceil(diffMs / 86400000);
  const label = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  if (done) return { label, className: "text-fg-subtle border-fg-subtle/25 bg-fg-subtle/5" };
  if (diffDays < 0) return { label: `${label} (overdue)`, className: "text-danger border-danger/30 bg-danger/10" };
  if (diffDays <= 2) return { label, className: "text-warning border-warning/30 bg-warning/10" };
  return { label, className: "text-fg-muted border-fg-subtle/25 bg-fg-subtle/5" };
}

interface TaskCardProps {
  task: Task;
  assigneeInitials?: string | null;
  assigneeName?: string | null;
  confirmingDelete: boolean;
  deleting: boolean;
  onEdit: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

export default function TaskCard({
  task,
  assigneeInitials,
  assigneeName,
  confirmingDelete,
  deleting,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { status: task.status },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const due = dueDateInfo(task.due_date, task.status === "done");

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={confirmingDelete ? undefined : onEdit}
      className="group/card w-full min-h-[230px] bg-bg-elevated border border-fg-subtle/15 rounded-lg p-4 flex flex-col gap-3 justify-between cursor-grab active:cursor-grabbing hover:border-fg-subtle/30 transition-colors duration-150"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 flex-1 break-words text-[13.5px] font-medium text-fg-primary leading-snug">
            {task.title}
          </span>
          {confirmingDelete ? (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onCancelDelete(); }}
                title="Cancel"
                className="flex items-center justify-center w-6 h-6 rounded-md text-fg-subtle hover:text-fg-primary hover:bg-fg-subtle/10 transition-colors duration-150 cursor-pointer"
              >
                <X size={12} strokeWidth={1.8} />
              </button>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onConfirmDelete(); }}
                disabled={deleting}
                title="Confirm delete"
                className="flex items-center justify-center w-6 h-6 rounded-md bg-danger text-bg-base hover:bg-danger/90 transition-colors duration-150 cursor-pointer disabled:opacity-50"
              >
                {deleting ? <RefreshCw size={12} strokeWidth={1.8} className="animate-spin" /> : <Check size={12} strokeWidth={2} />}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/card:opacity-100 transition-opacity duration-150">
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                title="Edit"
                className="flex items-center justify-center w-6 h-6 rounded-md text-fg-subtle hover:text-fg-primary hover:bg-fg-subtle/10 transition-colors duration-150 cursor-pointer"
              >
                <Pencil size={12} strokeWidth={1.8} />
              </button>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onRequestDelete(); }}
                title="Delete"
                className="flex items-center justify-center w-6 h-6 rounded-md text-fg-subtle hover:text-danger hover:bg-danger/10 transition-colors duration-150 cursor-pointer"
              >
                <Trash2 size={12} strokeWidth={1.8} />
              </button>
            </div>
          )}
        </div>

        {task.description && (
          <p className="text-[12px] text-fg-muted line-clamp-3 leading-snug">{task.description}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium border whitespace-nowrap ${PRIORITY_CLASS[task.priority]}`}
        >
          {PRIORITY_LABEL[task.priority]}
        </span>
        {task.labels.map((label) => (
          <span
            key={label}
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium border whitespace-nowrap"
            style={{ color: labelColor(label), borderColor: `color-mix(in srgb, ${labelColor(label)} 35%, transparent)`, background: `color-mix(in srgb, ${labelColor(label)} 12%, transparent)` }}
          >
            {label}
          </span>
        ))}
        {due && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium border whitespace-nowrap ${due.className}`}
          >
            <CalendarClock size={10} strokeWidth={2} />
            {due.label}
          </span>
        )}
        {task.sentinel_id && (
          <span
            title="Linked to a sentinel"
            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-sine-indigo/10 text-sine-indigo shrink-0"
          >
            <SatelliteDish size={11} strokeWidth={1.8} />
          </span>
        )}
        {assigneeInitials && (
          <span
            title={assigneeName ? `Assigned to ${assigneeName}` : "Assigned"}
            className="ml-auto inline-flex items-center justify-center w-5 h-5 rounded-full bg-fg-subtle/15 text-[9px] font-semibold text-fg-primary shrink-0"
          >
            {assigneeInitials}
          </span>
        )}
      </div>
    </div>
  );
}
