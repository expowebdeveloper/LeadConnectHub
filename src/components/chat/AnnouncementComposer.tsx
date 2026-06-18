import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { postAnnouncement } from "@/lib/chat-stage2.functions";
import { setAnnouncementFlags } from "@/lib/chat-crm.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Megaphone, AlertTriangle, Pin } from "lucide-react";

export function AnnouncementComposer({
  open,
  onClose,
  conversationId,
  onPosted,
}: {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  onPosted?: () => void;
}) {
  const post = useServerFn(postAnnouncement);
  const flagsFn = useServerFn(setAnnouncementFlags);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [requireAck, setRequireAck] = useState(true);
  const [highPriority, setHighPriority] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!title.trim() || !body.trim()) return;
    setSending(true);
    try {
      const res = await post({ data: { conversationId, title: title.trim(), body: body.trim(), requireAck } });
      if (highPriority || pinned || requireAck) {
        await flagsFn({
          data: {
            messageId: res.id,
            isHighPriority: highPriority,
            requiresAck: requireAck,
            isPinnedAnnouncement: pinned,
          },
        }).catch(() => {});
      }
      toast.success("Announcement posted");
      setTitle("");
      setBody("");
      setHighPriority(false);
      setPinned(false);
      onPosted?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-amber-500" />
            New announcement
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            maxLength={200}
          />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What do you need everyone to know?"
            rows={8}
          />
          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={requireAck}
                onChange={(e) => setRequireAck(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Require acknowledgement
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={highPriority}
                onChange={(e) => setHighPriority(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              High priority
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              <Pin className="h-3.5 w-3.5 text-chat-accent" />
              Pin announcement
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={sending || !title.trim() || !body.trim()}>
            <Megaphone className="mr-1.5 h-4 w-4" />
            Post announcement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
