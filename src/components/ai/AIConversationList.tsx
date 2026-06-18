import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listAiConversations, createAiConversation, deleteAiConversation } from "@/lib/ai-context.functions";
import { Button } from "@/components/ui/button";
import { Plus, MessageSquare, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function AIConversationList({ activeId, onSelect }: { activeId: string | null; onSelect: (id: string | null) => void }) {
  const list = useServerFn(listAiConversations);
  const create = useServerFn(createAiConversation);
  const del = useServerFn(deleteAiConversation);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ai_conversations"], queryFn: () => list() });

  const createM = useMutation({
    mutationFn: () => create({ data: { title: "New conversation" } }),
    onSuccess: (c: any) => {
      qc.invalidateQueries({ queryKey: ["ai_conversations"] });
      if (c?.id) onSelect(c.id);
    },
  });
  const delM = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai_conversations"] }),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 p-3">
        <Button size="sm" className="w-full justify-start gap-2" onClick={() => onSelect(null)}>
          <Plus className="h-3.5 w-3.5" /> New question
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">Recent</div>
        {(q.data ?? []).map((c: any) => (
          <div
            key={c.id}
            className={cn(
              "group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent/60",
              activeId === c.id && "bg-accent text-accent-foreground",
            )}
          >
            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <button className="flex-1 truncate text-left" onClick={() => onSelect(c.id)} title={c.title}>
              {c.title || "Untitled"}
            </button>
            <button
              className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              onClick={() => { if (confirm("Delete conversation?")) delM.mutate(c.id); }}
              aria-label="Delete conversation"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
        {!q.data?.length && <div className="px-2 py-4 text-xs text-muted-foreground">No conversations yet.</div>}
      </div>
    </div>
  );
}