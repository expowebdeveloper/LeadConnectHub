import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { getRelatedLeadsForConversation } from "@/lib/chat-crm.functions";
import { Target, Phone, ExternalLink, Check, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "@/components/AgentAvatar";
import { format, isToday, isYesterday } from "date-fns";

type Lead = {
  id: string;
  name: string;
  phone: string | null;
  dispo: string | null;
  last_activity_at: string | null;
  owner: { full_name: string | null; email: string | null; avatar_url: string | null } | null;
};

export function RelatedLeadsSection({
  conversationId,
  refreshKey,
  onCreateTask,
  onAddNote,
}: {
  conversationId: string;
  refreshKey?: unknown;
  onCreateTask?: (leadId: string) => void;
  onAddNote?: (leadId: string) => void;
}) {
  const list = useServerFn(getRelatedLeadsForConversation);
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);

  useEffect(() => {
    void list({ data: { conversationId } }).then((r) => setLeads(r.leads as Lead[])).catch(() => {});
  }, [conversationId, list, refreshKey]);

  if (leads.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground">
        Paste a /leads/&lt;id&gt; URL in chat to link a lead.
      </div>
    );
  }

  const fmt = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isToday(d)) return format(d, "h:mm a");
    if (isYesterday(d)) return "Yesterday";
    return format(d, "MMM d");
  };

  return (
    <div className="space-y-2">
      {leads.map((l) => (
        <div key={l.id} className="rounded-md border border-border bg-background p-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Target className="h-3 w-3 text-chat-accent" />
                <span className="truncate text-xs font-semibold">{l.name}</span>
              </div>
              {l.phone && <div className="mt-0.5 text-[11px] text-muted-foreground">{l.phone}</div>}
              {l.dispo && (
                <span className="mt-1 inline-block rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-secondary-foreground">
                  {l.dispo}
                </span>
              )}
            </div>
            {l.owner && (
              <div className="shrink-0" title={l.owner.full_name ?? l.owner.email ?? "Owner"}>
                <AgentAvatar name={l.owner.full_name ?? l.owner.email} path={l.owner.avatar_url} size="sm" />
              </div>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">{fmt(l.last_activity_at)}</span>
            <div className="flex items-center gap-0.5">
              <Button size="icon" variant="ghost" className="h-6 w-6" title="Open lead"
                onClick={() => navigate({ to: "/leads/$leadId", params: { leadId: l.id } })}
              >
                <ExternalLink className="h-3 w-3" />
              </Button>
              {l.phone && (
                <a
                  href={`tel:${l.phone}`}
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                  title="Start call"
                >
                  <Phone className="h-3 w-3" />
                </a>
              )}
              {onAddNote && (
                <Button size="icon" variant="ghost" className="h-6 w-6" title="Add note"
                  onClick={() => onAddNote(l.id)}
                >
                  <FileText className="h-3 w-3" />
                </Button>
              )}
              {onCreateTask && (
                <Button size="icon" variant="ghost" className="h-6 w-6" title="Create task"
                  onClick={() => onCreateTask(l.id)}
                >
                  <Check className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}