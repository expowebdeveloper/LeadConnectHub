import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollText } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettings } from "@/lib/settings";
import { SCRIPT_TYPES, type ScriptType } from "@/lib/constants";

export function LeadScriptButton({ scriptType, label }: { scriptType?: ScriptType; label?: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useSettings();
  const scripts = data?.scripts ?? ({} as Record<ScriptType, string>);
  const matched = scriptType && SCRIPT_TYPES.some((t) => t.value === scriptType) ? scriptType : undefined;
  const [selected, setSelected] = useState<ScriptType | undefined>(matched);
  const active: ScriptType | undefined = selected ?? matched;
  const script = active ? (scripts[active] ?? "").trim() : "";
  const activeLabel =
    label ?? (active ? SCRIPT_TYPES.find((t) => t.value === active)?.label ?? active : "Call");
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation();
          if (!selected && matched) setSelected(matched);
          setOpen(true);
        }}
        title="Open call script"
      >
        <ScrollText className="h-3 w-3" />
        script
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{activeLabel} call script</DialogTitle>
            <DialogDescription>
              Pick a script for this call. Managed by your admin in Settings → Scripts.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Script type</span>
            <Select
              value={active ?? ""}
              onValueChange={(v) => setSelected(v as ScriptType)}
            >
              <SelectTrigger className="h-8 w-[220px] text-xs">
                <SelectValue placeholder="Choose a script…" />
              </SelectTrigger>
              <SelectContent>
                {SCRIPT_TYPES.map((t) => {
                  const has = (scripts[t.value] ?? "").trim().length > 0;
                  return (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                      {has ? "" : " — empty"}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          {script ? (
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-4 text-sm leading-relaxed font-sans">
              {script}
            </pre>
          ) : active ? (
            <p className="rounded-md border bg-muted p-4 text-sm text-muted-foreground">
              No script has been uploaded for {activeLabel.toLowerCase()} yet. Ask an admin to add one in Settings → Scripts.
            </p>
          ) : (
            <p className="rounded-md border bg-muted p-4 text-sm text-muted-foreground">
              Choose a script type above to view the call script.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}