import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listPinnedMessages } from "@/lib/chat-crm.functions";
import { Pin } from "lucide-react";
import { format } from "date-fns";

type Pin = {
  pin_id: string;
  message_id: string;
  body: string | null;
  created_at: string;
  sender: { full_name: string | null; email: string | null } | null;
};

export function PinnedMessagesSection({
  conversationId,
  refreshKey,
  onJump,
}: {
  conversationId: string;
  refreshKey?: unknown;
  onJump?: (messageId: string) => void;
}) {
  const list = useServerFn(listPinnedMessages);
  const [pins, setPins] = useState<Pin[]>([]);

  useEffect(() => {
    void list({ data: { conversationId } }).then((r) => setPins(r.pins as Pin[])).catch(() => {});
  }, [conversationId, list, refreshKey]);

  if (pins.length === 0) {
    return <div className="text-[11px] text-muted-foreground">No pinned messages yet.</div>;
  }

  return (
    <div className="space-y-1.5">
      {pins.map((p) => (
        <button
          key={p.pin_id}
          onClick={() => onJump?.(p.message_id)}
          className="block w-full rounded-md border border-border bg-background p-2 text-left hover:border-chat-accent/40"
        >
          <div className="flex items-center gap-1.5">
            <Pin className="h-3 w-3 text-chat-accent" />
            <span className="text-[11px] font-medium">{p.sender?.full_name ?? p.sender?.email ?? "Someone"}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{format(new Date(p.created_at), "MMM d")}</span>
          </div>
          <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.body ?? ""}</div>
        </button>
      ))}
    </div>
  );
}