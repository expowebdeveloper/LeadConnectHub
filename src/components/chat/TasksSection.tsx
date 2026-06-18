import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listChatTasks, updateChatTask, deleteChatTask } from "@/lib/chat-crm.functions";
import { Button } from "@/components/ui/button";
import { Check, Plus, Trash2 } from "lucide-react";
import { format, isPast } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Task = {
  id: string;
  title: string;
  status: "open" | "done";
  priority: "low" | "normal" | "high" | "urgent";
  due_at: string | null;
  assignee_profile: { full_name: string | null; email: string | null } | null;
};

const PRIORITY_COLOR: Record<Task["priority"], string> = {
  low: "text-muted-foreground",
  normal: "text-chat-accent",
  high: "text-amber-500",
  urgent: "text-rose-500",
};

export function TasksSection({
  conversationId,
  refreshKey,
  onNewTask,
}: {
  conversationId: string;
  refreshKey?: unknown;
  onNewTask?: () => void;
}) {
  const list = useServerFn(listChatTasks);
  const updateFn = useServerFn(updateChatTask);
  const delFn = useServerFn(deleteChatTask);
  const [tasks, setTasks] = useState<Task[]>([]);

  const reload = () => {
    void list({ data: { conversationId } }).then((r) => setTasks(r.tasks as Task[])).catch(() => {});
  };

  useEffect(reload, [conversationId, list, refreshKey]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {tasks.filter((t) => t.status === "open").length} open · {tasks.length} total
        </span>
        {onNewTask && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-chat-accent" onClick={onNewTask}>
            <Plus className="mr-1 h-3 w-3" /> New
          </Button>
        )}
      </div>
      {tasks.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">No tasks yet.</div>
      ) : (
        tasks.map((t) => (
          <div key={t.id} className={cn("group rounded-md border border-border bg-background p-2", t.status === "done" && "opacity-60")}>
            <div className="flex items-start gap-2">
              <button
                onClick={async () => {
                  try {
                    await updateFn({ data: { id: t.id, status: t.status === "done" ? "open" : "done" } });
                    reload();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  }
                }}
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                  t.status === "done" ? "border-chat-accent bg-chat-accent text-chat-accent-foreground" : "border-border hover:border-chat-accent/50",
                )}
              >
                {t.status === "done" && <Check className="h-3 w-3" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className={cn("text-xs font-medium", t.status === "done" && "line-through")}>{t.title}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px]">
                  <span className={cn("font-semibold uppercase tracking-wider", PRIORITY_COLOR[t.priority])}>{t.priority}</span>
                  {t.due_at && (
                    <span className={cn(isPast(new Date(t.due_at)) && t.status === "open" && "text-rose-500")}>
                      {format(new Date(t.due_at), "MMM d")}
                    </span>
                  )}
                  {t.assignee_profile && (
                    <span className="text-muted-foreground">@{t.assignee_profile.full_name ?? t.assignee_profile.email}</span>
                  )}
                </div>
              </div>
              <button
                onClick={async () => {
                  try {
                    await delFn({ data: { id: t.id } });
                    reload();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  }
                }}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                title="Delete"
              >
                <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}