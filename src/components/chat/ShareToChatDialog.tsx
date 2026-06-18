import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyConversations, type ConversationSummary } from "@/lib/chat.functions";
import { shareLeadToConversation, getOrCreateLeadConversation } from "@/lib/chat-stage2.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Hash, MessageSquare, Lock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export function ShareToChatDialog({
  open,
  onClose,
  leadId,
  leadName,
}: {
  open: boolean;
  onClose: () => void;
  leadId: string;
  leadName?: string;
}) {
  const list = useServerFn(listMyConversations);
  const share = useServerFn(shareLeadToConversation);
  const createLeadConv = useServerFn(getOrCreateLeadConversation);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const convsQ = useQuery({
    queryKey: ["chat.conversations"],
    queryFn: () => list(),
    enabled: open,
  });
  const conversations = convsQ.data?.conversations ?? [];

  const filtered = conversations.filter((c) => {
    const label = c.type === "dm" ? c.other_user?.name ?? "" : c.name ?? "";
    return !filter.trim() || label.toLowerCase().includes(filter.trim().toLowerCase());
  });

  const submit = async () => {
    if (!selected) return;
    setSending(true);
    try {
      await share({ data: { leadId, conversationId: selected, note: note.trim() || undefined } });
      toast.success("Shared to chat");
      setNote("");
      setSelected(null);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to share");
    } finally {
      setSending(false);
    }
  };

  const startDiscussion = async () => {
    setSending(true);
    try {
      const { id } = await createLeadConv({ data: { leadId, leadName } });
      window.open(`/team-chat?c=${id}`, "_blank");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create conversation");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1rem)] max-w-md flex-col gap-0 p-0 sm:w-full">
        <DialogHeader className="px-4 pt-4 sm:px-6 sm:pt-6">
          <DialogTitle>Share lead to chat</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 sm:px-6">
          <Button onClick={startDiscussion} variant="outline" className="w-full justify-start" disabled={sending}>
            <MessageSquare className="mr-2 h-4 w-4" />
            Start dedicated lead discussion
          </Button>
          <div className="text-center text-[10px] uppercase tracking-widest text-muted-foreground">
            or share to an existing conversation
          </div>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search conversations…"
          />
          <div className="max-h-56 overflow-y-auto overscroll-contain rounded-md border border-border touch-pan-y">
            <div className="space-y-0.5 p-1">
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelected(c.id)}
                  className={cn(
                    "flex w-full min-h-11 touch-manipulation items-center gap-2 rounded px-2 py-2 text-left text-sm",
                    selected === c.id ? "bg-accent text-accent-foreground" : "hover:bg-accent/40",
                  )}
                >
                  <ConvIcon c={c} />
                  <span className="flex-1 truncate">
                    {c.type === "dm" ? c.other_user?.name : `# ${c.name}`}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="p-3 text-center text-xs text-muted-foreground">No conversations</div>
              )}
            </div>
          </div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note…"
            rows={2}
          />
        </div>
        <DialogFooter className="gap-2 border-t px-4 py-3 sm:px-6">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!selected || sending}>
            Share
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConvIcon({ c }: { c: ConversationSummary }) {
  if (c.type === "dm") return <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />;
  if (c.is_private) return <Lock className="h-3.5 w-3.5 text-muted-foreground" />;
  return <Hash className="h-3.5 w-3.5 text-muted-foreground" />;
}
