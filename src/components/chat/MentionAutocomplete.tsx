import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { searchTeammates } from "@/lib/chat.functions";
import { cn } from "@/lib/utils";

export type MentionPick = { id: string; name: string };

export function MentionAutocomplete({
  query,
  onPick,
  onDismiss,
}: {
  query: string;
  onPick: (u: MentionPick) => void;
  onDismiss: () => void;
}) {
  const search = useServerFn(searchTeammates);
  const [results, setResults] = useState<MentionPick[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void search({ data: { q: query } }).then((res) => {
      if (cancelled) return;
      const items: MentionPick[] = res.users.map((u) => ({
        id: u.id,
        name: u.full_name ?? u.email ?? "Teammate",
      }));
      // include @everyone
      items.unshift({ id: "__everyone__", name: "everyone (notify channel)" });
      setResults(items);
      setActive(0);
    });
    return () => {
      cancelled = true;
    };
  }, [query, search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (results[active]) {
          e.preventDefault();
          onPick(results[active]);
        }
      } else if (e.key === "Escape") {
        onDismiss();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [results, active, onPick, onDismiss]);

  if (!results.length) return null;

  return (
    <div className="absolute bottom-full left-0 mb-2 w-64 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
      <div className="border-b border-border bg-muted/30 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        People
      </div>
      <div className="max-h-56 overflow-y-auto">
        {results.map((r, i) => (
          <button
            key={r.id}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(r);
            }}
            onMouseEnter={() => setActive(i)}
            className={cn(
              "block w-full px-2 py-1.5 text-left text-sm",
              i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/40",
            )}
          >
            @{r.name}
          </button>
        ))}
      </div>
    </div>
  );
}
