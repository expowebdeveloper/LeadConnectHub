import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  summarizeConversation,
  extractActionItems,
  suggestFollowUpTask,
  draftReply,
  suggestRelatedLead,
} from "@/lib/chat-ai.functions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Sparkles, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Mode = "summary" | "actions" | "task" | "reply" | "lead";

export function AIPopover({
  conversationId,
  onDraftReply,
  onCreateTaskFromAI,
}: {
  conversationId: string;
  onDraftReply?: (text: string) => void;
  onCreateTaskFromAI?: (title: string, description: string) => void;
}) {
  const sum = useServerFn(summarizeConversation);
  const acts = useServerFn(extractActionItems);
  const task = useServerFn(suggestFollowUpTask);
  const reply = useServerFn(draftReply);
  const lead = useServerFn(suggestRelatedLead);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Mode | null>(null);
  const [result, setResult] = useState<{ mode: Mode; data: unknown } | null>(null);

  const run = async (mode: Mode) => {
    setBusy(mode);
    setResult(null);
    try {
      if (mode === "summary") {
        const r = await sum({ data: { conversationId } });
        setResult({ mode, data: r.text });
      } else if (mode === "actions") {
        const r = await acts({ data: { conversationId } });
        setResult({ mode, data: r.items });
      } else if (mode === "task") {
        const r = await task({ data: { conversationId } });
        setResult({ mode, data: r });
      } else if (mode === "reply") {
        const r = await reply({ data: { conversationId } });
        setResult({ mode, data: r.text });
      } else if (mode === "lead") {
        const r = await lead({ data: { conversationId } });
        setResult({ mode, data: r.leads });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI request failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setResult(null); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-chat-accent" title="AI helpers">
          <Sparkles className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-chat-accent">
          <Sparkles className="h-3 w-3" /> AI helpers
        </div>
        <div className="grid grid-cols-2 gap-1">
          <AIButton label="Summarize" busy={busy === "summary"} onClick={() => run("summary")} />
          <AIButton label="Action items" busy={busy === "actions"} onClick={() => run("actions")} />
          <AIButton label="Suggest task" busy={busy === "task"} onClick={() => run("task")} />
          <AIButton label="Draft reply" busy={busy === "reply"} onClick={() => run("reply")} />
          <AIButton label="Suggest lead" busy={busy === "lead"} onClick={() => run("lead")} className="col-span-2" />
        </div>
        {result && (
          <div className="mt-2 rounded-md border border-border bg-muted/30 p-2 text-xs">
            {result.mode === "summary" || result.mode === "reply" ? (
              <div className="space-y-2">
                <pre className="whitespace-pre-wrap break-words font-sans">{String(result.data)}</pre>
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => { navigator.clipboard.writeText(String(result.data)); toast.success("Copied"); }}>
                    <Copy className="mr-1 h-3 w-3" /> Copy
                  </Button>
                  {result.mode === "reply" && onDraftReply && (
                    <Button size="sm" className="h-6 px-2" onClick={() => { onDraftReply(String(result.data)); setOpen(false); }}>
                      Insert
                    </Button>
                  )}
                </div>
              </div>
            ) : result.mode === "actions" ? (
              <ul className="list-disc space-y-0.5 pl-4">
                {(result.data as string[]).map((it, i) => <li key={i}>{it}</li>)}
                {(result.data as string[]).length === 0 && <div className="text-muted-foreground">No action items found.</div>}
              </ul>
            ) : result.mode === "task" ? (
              <div className="space-y-1">
                <div className="font-semibold">{(result.data as { title: string }).title || "No suggestion"}</div>
                <div className="text-muted-foreground">{(result.data as { description: string }).description}</div>
                {(result.data as { title: string }).title && onCreateTaskFromAI && (
                  <Button size="sm" className="mt-1 h-7" onClick={() => {
                    const d = result.data as { title: string; description: string };
                    onCreateTaskFromAI(d.title, d.description);
                    setOpen(false);
                  }}>Create task</Button>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                {(result.data as Array<{ id: string; name: string; phone: string | null }>).length === 0 ? (
                  <div className="text-muted-foreground">No related leads detected.</div>
                ) : (
                  (result.data as Array<{ id: string; name: string; phone: string | null }>).map((l) => (
                    <a key={l.id} href={`/leads/${l.id}`} target="_blank" rel="noreferrer" className="block rounded border border-border bg-background px-2 py-1 hover:border-chat-accent/50">
                      <div className="font-medium">{l.name}</div>
                      {l.phone && <div className="text-[10px] text-muted-foreground">{l.phone}</div>}
                    </a>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function AIButton({ label, busy, onClick, className }: { label: string; busy: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`flex items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-xs hover:border-chat-accent/50 hover:bg-chat-accent/5 disabled:opacity-60 ${className ?? ""}`}
    >
      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
      {label}
    </button>
  );
}