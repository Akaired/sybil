import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus, RefreshCw, ArrowUpDown } from "lucide-react";
import { copy } from "../config/tokens";
import { AuthContext } from "../contexts/AuthContext";
import SineWave from "../components/SineWave";
import TaskCard from "../components/TaskCard";
import TaskModal, { type TaskModalSubmit } from "../components/TaskModal";
import {
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  positionBetween,
  listWorkspaceMembers,
  TASK_STATUSES,
  type Task,
  type TaskStatus,
  type WorkspaceMember,
} from "../lib/tasks";

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  doing: "Doing",
  done: "Done",
};

const STATUS_DOT: Record<TaskStatus, string> = {
  backlog: "bg-fg-subtle",
  todo: "bg-sine-indigo",
  doing: "bg-sine-amber",
  done: "bg-success",
};

const PRIORITY_RANK: Record<Task["priority"], number> = { urgent: 0, high: 1, medium: 2, low: 3 };

type SortMode = "manual" | "priority" | "due";
const SORT_LABEL: Record<SortMode, string> = { manual: "Manual", priority: "Priority", due: "Due date" };
const SORT_CYCLE: Record<SortMode, SortMode> = { manual: "priority", priority: "due", due: "manual" };

function sortTasks(tasks: Task[], mode: SortMode): Task[] {
  const arr = [...tasks];
  if (mode === "priority") {
    return arr.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.position - b.position);
  }
  if (mode === "due") {
    return arr.sort((a, b) => {
      if (!a.due_date && !b.due_date) return a.position - b.position;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    });
  }
  return arr.sort((a, b) => a.position - b.position);
}

function DroppableColumn({ status, children }: { status: TaskStatus; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} className="flex flex-col gap-2 min-h-[80px]">
      {children}
    </div>
  );
}

export default function Tasks() {
  const { user, activeWorkspaceId } = useContext(AuthContext);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sortModeByColumn, setSortModeByColumn] = useState<Record<TaskStatus, SortMode>>({
    backlog: "manual",
    todo: "manual",
    doing: "manual",
    done: "manual",
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [modalTask, setModalTask] = useState<Task | null>(null);
  const [modalDefaultStatus, setModalDefaultStatus] = useState<TaskStatus>("backlog");

  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const fetchTasks = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!activeWorkspaceId) return;
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const data = await listTasks(activeWorkspaceId);
        setTasks(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load tasks.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeWorkspaceId],
  );

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    listWorkspaceMembers(activeWorkspaceId)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [activeWorkspaceId]);

  const membersById = useMemo(() => {
    const map = new Map<string, WorkspaceMember>();
    for (const m of members) map.set(m.userId, m);
    return map;
  }, [members]);

  function handleRefresh() {
    setRefreshing(true);
    fetchTasks({ silent: true });
  }

  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = { backlog: [], todo: [], doing: [], done: [] };
    for (const t of tasks) grouped[t.status].push(t);
    return grouped;
  }, [tasks]);

  function cycleSortMode(status: TaskStatus) {
    setSortModeByColumn((prev) => ({ ...prev, [status]: SORT_CYCLE[prev[status]] }));
  }

  // ── Drag and drop ────────────────────────────────────────────

  function onDragStart(event: DragStartEvent) {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task ?? null);
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const activeTaskRow = tasks.find((t) => t.id === activeId);
    if (!activeTaskRow) return;

    const overIsColumn = (TASK_STATUSES as string[]).includes(overId);
    const overStatus = overIsColumn ? (overId as TaskStatus) : tasks.find((t) => t.id === overId)?.status;
    if (!overStatus || overStatus === activeTaskRow.status) return;

    setTasks((prev) => prev.map((t) => (t.id === activeId ? { ...t, status: overStatus } : t)));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(null);
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const activeTaskRow = tasks.find((t) => t.id === activeId);
    if (!activeTaskRow) return;

    const overIsColumn = (TASK_STATUSES as string[]).includes(overId);
    const finalStatus = overIsColumn
      ? (overId as TaskStatus)
      : (tasks.find((t) => t.id === overId)?.status ?? activeTaskRow.status);

    const siblings = tasks
      .filter((t) => t.status === finalStatus && t.id !== activeId)
      .sort((a, b) => a.position - b.position);

    let newIndex = siblings.length;
    if (!overIsColumn) {
      const overIndex = siblings.findIndex((t) => t.id === overId);
      if (overIndex !== -1) newIndex = overIndex;
    }
    const before = siblings[newIndex - 1]?.position ?? null;
    const after = siblings[newIndex]?.position ?? null;
    const newPosition = positionBetween(before, after);

    setTasks((prev) =>
      prev.map((t) => (t.id === activeId ? { ...t, status: finalStatus, position: newPosition } : t)),
    );

    updateTask(activeId, { status: finalStatus, position: newPosition }).catch(() => {
      // Out-of-sync with the server — reload to recover instead of leaving a stale local state.
      fetchTasks({ silent: true });
    });
  }

  // ── Modal / CRUD ─────────────────────────────────────────────

  function openNewTaskModal(status: TaskStatus) {
    setModalTask(null);
    setModalDefaultStatus(status);
    setModalOpen(true);
  }

  function openEditModal(task: Task) {
    setModalTask(task);
    setModalOpen(true);
  }

  async function handleModalSubmit(values: TaskModalSubmit) {
    if (modalTask) {
      await updateTask(modalTask.id, values);
      setTasks((prev) => prev.map((t) => (t.id === modalTask.id ? { ...t, ...values } : t)));
    } else {
      if (!activeWorkspaceId || !user) return;
      const columnTasks = tasksByStatus[values.status];
      const lastPosition = columnTasks.length
        ? Math.max(...columnTasks.map((t) => t.position))
        : null;
      const position = positionBetween(lastPosition, null);
      const created = await createTask(activeWorkspaceId, user.id, { ...values, position });
      setTasks((prev) => [...prev, created]);
    }
  }

  async function handleModalDelete() {
    if (!modalTask) return;
    await deleteTask(modalTask.id);
    setTasks((prev) => prev.filter((t) => t.id !== modalTask.id));
  }

  async function confirmCardDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch {
      // Leave the card in place — the user can retry the delete.
    } finally {
      setDeletingId(null);
      setConfirmingDeleteId(null);
    }
  }

  const isEmpty = !loading && tasks.length === 0;

  return (
    <div className="w-full max-w-[1400px] mx-auto p-6">
      <div className="flex items-start justify-between gap-4 mb-2.5 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-fg-primary">{copy.pages.tasks.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            title="Refresh"
            className="flex items-center justify-center w-8 h-8 rounded-md border border-fg-subtle/25 text-fg-muted hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 cursor-pointer"
          >
            <RefreshCw size={14} strokeWidth={1.8} className={refreshing ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => openNewTaskModal("backlog")}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-success text-bg-base text-sm font-semibold hover:bg-success/90 transition-colors duration-150 cursor-pointer"
          >
            <Plus size={14} strokeWidth={2.5} />
            New task
          </button>
        </div>
      </div>
      <p className="text-fg-muted text-sm mb-8">{copy.pages.tasks.subtitle}</p>

      {loading && (
        <div className="flex items-center gap-3 text-fg-muted py-8">
          <SineWave state="thinking" height={24} className="w-24" />
          <span className="text-sm animate-pulse">Loading tasks…</span>
        </div>
      )}

      {error && !loading && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm text-fg-primary mb-4">
          {error}
        </div>
      )}

      {!loading && !error && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2">
            {TASK_STATUSES.map((status) => {
              const columnTasks = sortTasks(tasksByStatus[status], sortModeByColumn[status]);
              return (
                <div
                  key={status}
                  className="w-[calc(100%-40px)] shrink-0 snap-center sm:w-auto sm:flex-1 sm:min-w-[280px] sm:shrink flex flex-col"
                >
                  <div className="flex items-center justify-between gap-2 px-1 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
                      <span className="text-sm font-semibold text-fg-primary truncate">{STATUS_LABEL[status]}</span>
                      <span className="text-[11px] font-mono text-fg-subtle bg-fg-subtle/10 rounded-full px-1.5 py-0.5 shrink-0">
                        {columnTasks.length}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => cycleSortMode(status)}
                        title={`Sort: ${SORT_LABEL[sortModeByColumn[status]]}`}
                        className="flex items-center justify-center w-6 h-6 rounded-md text-fg-subtle hover:text-fg-primary hover:bg-fg-subtle/10 transition-colors duration-150 cursor-pointer"
                      >
                        <ArrowUpDown size={12} strokeWidth={1.8} />
                      </button>
                      <button
                        onClick={() => openNewTaskModal(status)}
                        title={`New task in ${STATUS_LABEL[status]}`}
                        className="flex items-center justify-center w-6 h-6 rounded-md text-fg-subtle hover:text-fg-primary hover:bg-fg-subtle/10 transition-colors duration-150 cursor-pointer"
                      >
                        <Plus size={13} strokeWidth={2} />
                      </button>
                    </div>
                  </div>

                  <SortableContext items={columnTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                    <DroppableColumn status={status}>
                      {columnTasks.length === 0 && (
                        <div className="border border-dashed border-fg-subtle/20 rounded-lg px-3 py-6 text-center">
                          <p className="text-[12px] text-fg-subtle">No tasks here</p>
                        </div>
                      )}
                      {columnTasks.map((task) => {
                        const assignee = task.assignee_id ? membersById.get(task.assignee_id) : null;
                        return (
                          <TaskCard
                            key={task.id}
                            task={task}
                            assigneeInitials={members.length > 1 ? assignee?.initials : null}
                            assigneeName={assignee?.name}
                            confirmingDelete={confirmingDeleteId === task.id}
                            deleting={deletingId === task.id}
                            onEdit={() => openEditModal(task)}
                            onRequestDelete={() => setConfirmingDeleteId(task.id)}
                            onCancelDelete={() => setConfirmingDeleteId(null)}
                            onConfirmDelete={() => confirmCardDelete(task.id)}
                          />
                        );
                      })}
                    </DroppableColumn>
                  </SortableContext>
                </div>
              );
            })}
          </div>

          <DragOverlay>
            {activeTask && (
              <div className="bg-bg-elevated border border-sine-indigo/40 rounded-lg p-4 w-[280px] min-h-[230px] shadow-xl">
                <span className="text-[13.5px] font-medium text-fg-primary">{activeTask.title}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {isEmpty && (
        <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-6 text-center mt-2">
          <p className="text-fg-muted text-sm">No tasks yet — create one, or ask Sybil in chat.</p>
        </div>
      )}

      <TaskModal
        open={modalOpen}
        task={modalTask}
        defaultStatus={modalDefaultStatus}
        members={members}
        onClose={() => setModalOpen(false)}
        onSubmit={handleModalSubmit}
        onDelete={modalTask ? handleModalDelete : undefined}
      />
    </div>
  );
}
