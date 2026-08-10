import type { ReactNode } from "react";
import {
  MessageSquare,
  Send,
  Mic,
  Mail,
  CalendarDays,
  CalendarPlus,
  Globe,
  Eye,
  Cpu,
  ListPlus,
  PencilLine,
  MinusCircle,
  Trash2,
  Inbox,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
} from "lucide-react";

// Shared between Activity.tsx (full timeline) and Pulse.tsx (compact list) —
// both render sybil_resolutions the same way.

export interface Resolution {
  id: string;
  signal_id: string;
  action: string;
  outcome: "success" | "partial" | "error" | "pending";
  detail: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
}

export const originLabel: Record<string, string> = {
  chat: "Chat",
  telegram: "Telegram",
  voice: "Voice",
  email: "Email",
  calendar: "Calendar",
  web: "Web",
  sentinel: "Sentinel",
  system: "System",
};

export const originIcon: Record<string, ReactNode> = {
  chat: <MessageSquare size={11} strokeWidth={2} />,
  telegram: <Send size={11} strokeWidth={2} />,
  voice: <Mic size={11} strokeWidth={2} />,
  email: <Mail size={11} strokeWidth={2} />,
  calendar: <CalendarDays size={11} strokeWidth={2} />,
  web: <Globe size={11} strokeWidth={2} />,
  sentinel: <Eye size={11} strokeWidth={2} />,
  system: <Cpu size={11} strokeWidth={2} />,
};

export const actionLabel: Record<string, string> = {
  reply: "Reply",
  create_task: "Task created",
  update_task: "Task updated",
  delete_task: "Task deleted",
  create_sentinel: "Sentinel created",
  delete_sentinel: "Sentinel deleted",
  no_action: "No action",
  calendar_event: "Calendar event",
  create_calendar_event: "Calendar event created",
  read_calendar: "Calendar checked",
  send_email: "Send email",
  read_emails: "Emails checked",
  delete_email: "Email deleted",
  web_visit: "Page visited",
  web_search: "Web search",
  web_research: "Web research",
};

export const actionIcon: Record<string, ReactNode> = {
  reply: <MessageSquare size={11} strokeWidth={2} />,
  create_task: <ListPlus size={11} strokeWidth={2} />,
  update_task: <PencilLine size={11} strokeWidth={2} />,
  delete_task: <Trash2 size={11} strokeWidth={2} />,
  create_sentinel: <Eye size={11} strokeWidth={2} />,
  delete_sentinel: <Trash2 size={11} strokeWidth={2} />,
  no_action: <MinusCircle size={11} strokeWidth={2} />,
  calendar_event: <CalendarDays size={11} strokeWidth={2} />,
  create_calendar_event: <CalendarPlus size={11} strokeWidth={2} />,
  read_calendar: <CalendarDays size={11} strokeWidth={2} />,
  send_email: <Mail size={11} strokeWidth={2} />,
  read_emails: <Inbox size={11} strokeWidth={2} />,
  delete_email: <Trash2 size={11} strokeWidth={2} />,
  web_visit: <Globe size={11} strokeWidth={2} />,
  web_search: <Globe size={11} strokeWidth={2} />,
  web_research: <Globe size={11} strokeWidth={2} />,
};

export const outcomeIcon: Record<string, ReactNode> = {
  success: <CheckCircle2 size={14} strokeWidth={2} className="text-success" />,
  error: <XCircle size={14} strokeWidth={2} className="text-danger" />,
  partial: <AlertTriangle size={14} strokeWidth={2} className="text-warning" />,
  pending: <Clock size={14} strokeWidth={2} className="text-fg-subtle" />,
};

function statusLabel(status: string): string {
  switch (status) {
    case "backlog": return "Backlog";
    case "todo": return "To Do";
    case "doing": return "Doing";
    case "done": return "Done";
    default: return status;
  }
}

// Every action's `detail` blob has a different shape (see supabase/functions/resolve).
// This turns it into one human-readable line instead of a raw dump or "No details".
export function resolutionSummary(r: Resolution): string {
  const d = r.detail || {};
  if (typeof d.error === "string" && d.error) return d.error;

  switch (r.action) {
    case "reply":
      return (d.reply_text as string) || "OK";
    case "no_action":
      return (d.reason as string) || "No action needed";
    case "create_task":
      return (d.task_title as string) ? `Created “${d.task_title}”` : "Task created";
    case "update_task": {
      const fields = d.updated_fields as string[] | undefined;
      const title = d.task_title as string | undefined;
      if (fields?.length === 1 && fields[0] === "status" && d.status) {
        return title ? `Moved “${title}” to ${statusLabel(d.status as string)}` : `Moved to ${statusLabel(d.status as string)}`;
      }
      if (fields?.length && title) return `Updated ${fields.join(", ")} on “${title}”`;
      return title ? `Updated “${title}”` : "Task updated";
    }
    case "delete_task":
      if (d.scope === "all") return `Deleted ${(d.deleted_count as number) ?? 0} task(s)`;
      return d.task_title ? `Deleted: ${d.task_title as string}` : "Task deleted";
    case "create_sentinel":
      return d.condition ? `Watching: ${d.condition as string}` : "Sentinel created";
    case "delete_sentinel":
      if (d.scope === "all") return `Deleted ${(d.deleted_count as number) ?? 0} sentinel(s)`;
      return d.condition ? `Deleted: ${d.condition as string}` : "Sentinel deleted";
    case "send_email":
      return "Email sent";
    case "delete_email":
      if (d.scope === "recent") return `Deleted ${(d.deleted_count as number) ?? 0} email(s)`;
      return d.subject ? `Deleted: ${d.subject as string}` : "Email deleted";
    case "create_calendar_event": {
      const ev = d.calendar_event as { summary?: string } | undefined;
      return ev?.summary ? `Created “${ev.summary}”` : "Event created";
    }
    case "calendar_event":
      return "Calendar event";
    case "read_calendar":
      return `${(d.count as number) ?? 0} event(s) found`;
    case "read_emails":
      return `${(d.count as number) ?? 0} email(s) found`;
    case "web_visit": {
      const url = d.url as string | undefined;
      if (!url) return "Page visited";
      try {
        return `Visited: ${new URL(url).hostname.replace(/^www\./, "")}`;
      } catch {
        return `Visited: ${url}`;
      }
    }
    case "web_search": {
      const results = (d.results as unknown[] | undefined) ?? [];
      return d.query ? `Searched: ${d.query as string}` : `${results.length} result(s) found`;
    }
    case "web_research":
      return d.query ? `Researched: ${d.query as string}` : "Web research done";
    default:
      return "Done";
  }
}

export function Chip({
  icon,
  label,
  className = "",
}: {
  icon: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border whitespace-nowrap ${className}`}
    >
      {icon}
      {label}
    </span>
  );
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
