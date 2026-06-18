import { useEffect, useState } from "react";
import { Hash, Check, FileText, Phone, ArrowRightLeft, Megaphone, BookmarkPlus } from "lucide-react";
import { cn } from "@/lib/utils";

export type SlashCommandId = "lead" | "task" | "note" | "call" | "transfer" | "template";

const COMMANDS: { id: SlashCommandId; label: string; hint: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "lead", label: "/lead", hint: "Link a lead by URL or ID", icon: Hash },
  { id: "task", label: "/task", hint: "Create a task", icon: Check },
  { id: "note", label: "/note", hint: "Send as note (saved to linked lead)", icon: FileText },
  { id: "call", label: "/call", hint: "Start a call", icon: Phone },
  { id: "transfer", label: "/transfer", hint: "Request a transfer", icon: ArrowRightLeft },
  { id: "template", label: "/template", hint: "Insert a template", icon: BookmarkPlus },
];

export function SlashCommandMenu({
  query,
  onPick,
  onDismiss,
}: {
  query: string;
  onPick: (id: SlashCommandId) => void;
  onDismiss: () => void;
}) {
  const filtered = COMMANDS.filter((c) => c.id.includes(query.toLowerCase()));
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [query]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter" && filtered[idx]) { e.preventDefault(); onPick(filtered[idx].id); }
      else if (e.key === "Escape") { onDismiss(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [filtered, idx, onPick, onDismiss]);

  if (!filtered.length) return null;
  return (
    <div className="absolute bottom-full left-0 mb-1 w-72 overflow-hidden rounded-lg border border-border bg-popover shadow-lg z-50">
      <div className="border-b border-border bg-muted/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Commands
      </div>
      <div className="max-h-72 overflow-y-auto p-1">
        {filtered.map((c, i) => (
          <button
            key={c.id}
            onClick={() => onPick(c.id)}
            onMouseEnter={() => setIdx(i)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
              i === idx ? "bg-chat-accent/15 text-foreground" : "hover:bg-accent/30",
            )}
          >
            <c.icon className="h-3.5 w-3.5 text-chat-accent" />
            <span className="font-mono text-[12px]">{c.label}</span>
            <span className="ml-auto text-[11px] text-muted-foreground">{c.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}