import { Link } from "react-router-dom";
import { Users, Eye } from "lucide-react";
import type { SharedConversationRow } from "../lib/sybil";

interface SharedChatListItemProps {
  conversation: SharedConversationRow;
  active: boolean;
}

export default function SharedChatListItem({ conversation, active }: SharedChatListItemProps) {
  return (
    <Link
      to={`/dashboard?c=${conversation.id}`}
      title={`${conversation.title} — shared by ${conversation.ownerEmail}`}
      className={`flex items-center gap-2.5 pl-3 pr-2.5 py-2 rounded-lg text-[13.5px] transition-colors duration-150 ${
        active
          ? "bg-sine-indigo/12 text-fg-primary"
          : "text-fg-muted hover:text-fg-primary hover:bg-bg-surface/50"
      }`}
    >
      <Users
        size={15}
        strokeWidth={1.8}
        className={`shrink-0 ${active ? "text-sine-indigo" : "text-fg-subtle"}`}
      />
      <span className="truncate flex-1 min-w-0">{conversation.title}</span>
      {conversation.access === "reader" && (
        <Eye size={12} strokeWidth={1.8} className="shrink-0 text-fg-subtle" aria-label="View only" />
      )}
      <span className="shrink-0 text-[10.5px] text-fg-subtle truncate max-w-[64px]">
        {conversation.ownerEmail.split("@")[0]}
      </span>
    </Link>
  );
}
