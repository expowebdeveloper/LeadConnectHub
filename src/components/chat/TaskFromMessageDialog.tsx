import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createChatTask } from "@/lib/chat-crm.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Check } from "lucide-react";

type Member = { user_id: string; name: string };

export function TaskFromMessageDialog({
  open,
  onClose,
  conversationId,
  messageId,
  leadId,
  initialTitle = "",
  initialDescription = "",
  members = [],
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  messageId?: string | null;
  leadId?: string | null;
  initialTitle?: string;
  initialDescription?: string;
  members?: Member[];
  onSaved?: () => void;
}) {
  const create = useServerFn(createChatTask);
  const [title, setTitle] = useState(initialTitle);
  const [desc, setDesc] = useState(initialDescription);
  const [assignee, setAssignee] = useState<string>("");
  const [priority, setPriority] = useState<"low" | "normal" | "high" | "urgent">("normal");
  const [dueAt, setDueAt] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle || "");
      setDesc(initialDescription || "");
      setAssignee("");
      setPriority("normal");
      setDueAt("");
    }
  }, [open, initialTitle, initialDescription]);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await create({
        data: {
          conversationId,
          messageId: messageId ?? null,
          leadId: leadId ?? null,
          title: title.trim(),
          description: desc.trim() || null,
          assignee: assignee || null,
          priority,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        },
      });
      toast.success("Task created");
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check className="h-4 w-4 text-chat-accent" />
            Create task
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" maxLength={500} autoFocus />
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Description (optional)</label>
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} maxLength={4000} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Assignee</label>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as typeof priority)}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Due date (optional)</label>
            <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
          {leadId && (
            <div className="rounded-md border border-chat-accent/30 bg-chat-accent/5 px-3 py-2 text-xs text-muted-foreground">
              Linked to lead <code className="rounded bg-muted px-1">{leadId.slice(0, 8)}…</code>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !title.trim()}>Save task</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}