// ============================================================
// Sybil Tasks — direct Supabase client for the sybil_tasks table
// RLS grants full SELECT/INSERT/UPDATE/DELETE to any workspace member,
// so (unlike calendar/mail) this talks to the table directly, no edge
// function needed for manual board interactions.
// ============================================================

import { supabase } from "../config/supabase";

export type TaskStatus = "backlog" | "todo" | "doing" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export const TASK_STATUSES: TaskStatus[] = ["backlog", "todo", "doing", "done"];
export const TASK_PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

export interface Task {
  id: string;
  workspace_id: string;
  project_id: string | null;
  assignee_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  wake_condition: string | null;
  sentinel_id: string | null;
  labels: string[];
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const TASK_COLUMNS =
  "id, workspace_id, project_id, assignee_id, title, description, status, priority, due_date, wake_condition, sentinel_id, labels, position, created_by, created_at, updated_at, completed_at";

export async function listTasks(workspaceId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("sybil_tasks")
    .select(TASK_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Task[];
}

export interface NewTaskInput {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string | null;
  labels?: string[];
  assignee_id?: string | null;
  position: number;
}

export async function createTask(
  workspaceId: string,
  createdBy: string,
  input: NewTaskInput,
): Promise<Task> {
  const { data, error } = await supabase
    .from("sybil_tasks")
    .insert({
      workspace_id: workspaceId,
      created_by: createdBy,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? "backlog",
      priority: input.priority ?? "medium",
      due_date: input.due_date ?? null,
      labels: input.labels ?? [],
      assignee_id: input.assignee_id ?? null,
      position: input.position,
    })
    .select(TASK_COLUMNS)
    .single();
  if (error) throw error;
  return data as Task;
}

export type TaskUpdateInput = Partial<
  Pick<Task, "title" | "description" | "status" | "priority" | "due_date" | "labels" | "assignee_id" | "position">
>;

export async function updateTask(id: string, updates: TaskUpdateInput): Promise<void> {
  const payload: Record<string, unknown> = { ...updates };
  // Moving a task in/out of Done keeps completed_at in sync automatically —
  // callers never need to set it themselves.
  if (updates.status !== undefined) {
    payload.completed_at = updates.status === "done" ? new Date().toISOString() : null;
  }
  const { error } = await supabase.from("sybil_tasks").update(payload).eq("id", id);
  if (error) throw error;
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from("sybil_tasks").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Fractional-index helper for manual drag ordering: a position strictly
 * between two neighbors, or ±1 at a column's edge. No periodic rebalancing —
 * not needed at this scale.
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 0;
  if (before === null) return (after as number) - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}

// Free-text labels get a deterministic color from this palette (hashed on
// the label text) instead of needing a label-management screen.
const LABEL_PALETTE = [
  "var(--color-sine-cyan)",
  "var(--color-sine-indigo)",
  "var(--color-sine-acid)",
  "var(--color-sine-mint)",
  "var(--color-sine-amber)",
  "var(--color-sine-signal)",
  "var(--color-sine-graphite)",
];

export function labelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return LABEL_PALETTE[hash % LABEL_PALETTE.length];
}

// ── Assignees ────────────────────────────────────────────────
// "Assigned to" only makes sense (and only renders) once a workspace has
// more than one member — a solo workspace has nobody else to assign to.

export interface WorkspaceMember {
  userId: string;
  email: string;
  name: string;
  initials: string;
}

// workspace_members has no display-name column — derive one from the
// email's local part, same approach as Team.tsx's labelFromEmail.
function labelFromEmail(email: string): { name: string; initials: string } {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  const name = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join(" ") || email;
  const initials =
    parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : local.slice(0, 2).toUpperCase();
  return { name, initials };
}

export async function listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("user_id, email")
    .eq("workspace_id", workspaceId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((m) => ({ userId: m.user_id, email: m.email, ...labelFromEmail(m.email) }));
}
