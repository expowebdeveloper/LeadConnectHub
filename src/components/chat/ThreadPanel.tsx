import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listThreadReplies } from "@/lib/chat-stage2.functions";
import { sendMessage } from "@/lib/chat.functions";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Send } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export function ThreadPanel({
  parentMessageId,
  conversationId,
  onClose,
}: {
  parentMessageId: string;
  conversationId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fetchThread = useServerFn(listThreadReplies);
  const send = useServerFn(sendMessage);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const q = useQuery({
    queryKey: ["chat.thread", parentMessageId],
    queryFn: () => fetchThread({ data: { parentMessageId } }),
    refetchInterval: 5_000,
  });

  const submit = async () => {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    try {
      await send({
        data: {
          conversationId,
          body: text,
          parentMessageId,
        },
      });
      setBody("");
      qc.invalidateQueries({ queryKey: ["chat.thread", parentMessageId] });
      qc.invalidateQueries({ queryKey: ["chat.messages", conversationId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <aside className="fixed inset-0 z-40 flex w-full shrink-0 flex-col border-l border-border bg-card md:static md:inset-auto md:z-auto md:w-80">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="text-sm font-semibold">Thread</div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-3 p-3">
          {q.data?.parent && (
            <ThreadMsg
              avatar={q.data.parent.sender_avatar}
              name={q.data.parent.sender_name}
              body={q.data.parent.body ?? ""}
              created_at={q.data.parent.created_at}
              isParent
            />
          )}
          <div className="border-t border-border pt-3">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {q.data?.replies.length ?? 0} {q.data?.replies.length === 1 ? "reply" : "replies"}
            </div>
            <div className="space-y-3">
              {q.data?.replies.map((r) => (
                <ThreadMsg
                  key={r.id}
                  avatar={r.sender_avatar}
                  name={r.sender_name}
                  body={r.body ?? ""}
                  created_at={r.created_at}
                />
              ))}
            </div>
          </div>
        </div>
      </ScrollArea>
      <div className="border-t border-border p-2">
        <div className="flex items-end gap-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Reply…"
            rows={2}
            className="resize-none"
          />
          <Button size="icon" onClick={() => void submit()} disabled={!body.trim() || sending}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}

function ThreadMsg({
  avatar,
  name,
  body,
  created_at,
  isParent,
}: {
  avatar: string | null;
  name: string;
  body: string;
  created_at: string;
  isParent?: boolean;
}) {
  return (
    <div className={isParent ? "" : "flex gap-2"}>
      {!isParent && <AgentAvatar name={name} path={avatar} size="sm" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold">{name}</span>
          <span className="text-[10px] text-muted-foreground">
            {format(new Date(created_at), "MMM d, h:mm a")}
          </span>
        </div>
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{body}</div>
      </div>
    </div>
  );
}
