import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { setCustomStatus } from "@/lib/chat-stage2.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const PRESETS = [
  { emoji: "✅", text: "Active", clear: null },
  { emoji: "📞", text: "On Call", clear: 30 },
  { emoji: "📝", text: "Quoting", clear: 60 },
  { emoji: "🔁", text: "Follow Up", clear: 60 },
  { emoji: "🍔", text: "Lunch", clear: 60 },
  { emoji: "☕", text: "Break", clear: 15 },
  { emoji: "📅", text: "Meeting", clear: 60 },
  { emoji: "🎧", text: "Do Not Disturb", clear: 120 },
  { emoji: "💤", text: "Away", clear: null },
  { emoji: "🏖️", text: "On Vacation", clear: null },
];

const CLEAR_OPTIONS: { label: string; value: number | null }[] = [
  { label: "Don't clear", value: null },
  { label: "30 min", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "4 hours", value: 240 },
  { label: "Today", value: 60 * 12 },
  { label: "This week", value: 60 * 24 * 7 },
];

export function CustomStatusDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const setFn = useServerFn(setCustomStatus);
  const [emoji, setEmoji] = useState("");
  const [text, setText] = useState("");
  const [clearIn, setClearIn] = useState<number | null>(240);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await setFn({ data: { emoji: emoji || null, text: text || null, clearInMinutes: clearIn } });
      toast.success("Status updated");
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await setFn({ data: { emoji: null, text: null, clearInMinutes: null } });
      setEmoji("");
      setText("");
      toast.success("Status cleared");
      onSaved?.();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set a status</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value.slice(0, 4))}
              placeholder="😀"
              className="w-16 text-center text-xl"
            />
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What's your status?"
              className="flex-1"
            />
          </div>
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Presets
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.text}
                  className="flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-xs hover:bg-accent/30"
                  onClick={() => {
                    setEmoji(p.emoji);
                    setText(p.text);
                    setClearIn(p.clear);
                  }}
                >
                  <span>{p.emoji}</span>
                  <span>{p.text}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Clear after
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CLEAR_OPTIONS.map((o) => (
                <button
                  key={o.label}
                  className={cn(
                    "rounded-full border px-2 py-1 text-xs",
                    clearIn === o.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card hover:bg-accent/30",
                  )}
                  onClick={() => setClearIn(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={clear} disabled={saving}>
            Clear status
          </Button>
          <Button onClick={save} disabled={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
