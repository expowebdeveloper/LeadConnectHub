import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listChatTemplates } from "@/lib/chat-crm.functions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { BookmarkPlus } from "lucide-react";

export function TemplatePicker({
  onPick,
  trigger,
}: {
  onPick: (body: string) => void;
  trigger?: React.ReactNode;
}) {
  const list = useServerFn(listChatTemplates);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Array<{ id: string; title: string; body: string }>>([]);

  useEffect(() => {
    if (!open) return;
    void list().then((r) => setItems(r.templates as typeof items)).catch(() => {});
  }, [open, list]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground" title="Templates">
            <BookmarkPlus className="h-4 w-4" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        <div className="border-b border-border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Quick templates
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {items.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">No templates yet.</div>
          ) : (
            items.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  onPick(t.body);
                  setOpen(false);
                }}
                className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/40"
              >
                <div className="text-xs font-medium text-foreground">{t.title}</div>
                <div className="truncate text-[11px] text-muted-foreground">{t.body}</div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}