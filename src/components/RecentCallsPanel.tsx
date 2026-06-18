import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getRecentCallLogs } from "@/lib/call-logs.functions";
import { Phone, PhoneIncoming, PhoneMissed } from "lucide-react";

type Scope = "me" | "lead" | "agent";

function fmtDuration(s: number | null | undefined): string {
  if (!s || s < 0) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function fmtPhone(p: string | null | undefined): string {
  if (!p) return "—";
  const digits = p.replace(/[^\d]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return p;
}

function outcomeBadge(outcome: string | null | undefined) {
  if (!outcome) return null;
  const label = outcome.replace(/_/g, " ");
  const good = outcome.startsWith("connected") || outcome === "sold";
  const bad = outcome === "no_answer" || outcome === "busy" || outcome === "no_answer_no_vm";
  return (
    <Badge
      variant={good ? "default" : bad ? "outline" : "secondary"}
      className="text-[10px] capitalize"
    >
      {label}
    </Badge>
  );
}

export function RecentCallsPanel({
  scope,
  leadId,
  leadTable,
  agentId,
  limit = 25,
  title = "Recent calls",
  emptyText = "No calls yet.",
}: {
  scope: Scope;
  leadId?: string | null;
  leadTable?: "leads" | "list_leads" | null;
  agentId?: string | null;
  limit?: number;
  title?: string;
  emptyText?: string;
}) {
  const fetchCalls = useServerFn(getRecentCallLogs);
  const q = useQuery({
    queryKey: ["call_logs", scope, leadId, leadTable, agentId, limit],
    queryFn: () =>
      fetchCalls({
        data: {
          scope,
          leadId: leadId ?? null,
          leadTable: leadTable ?? null,
          agentId: agentId ?? null,
          limit,
        },
      }),
    refetchInterval: 30_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">{title}</CardTitle>
        <Badge variant="outline" className="text-[10px]">
          {q.data?.length ?? 0}
        </Badge>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : q.error ? (
          <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        ) : (q.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="divide-y">
            {q.data!.map((r) => {
              const dt = r.started_at ? new Date(r.started_at) : null;
              const inbound = r.direction === "inbound";
              const missed =
                r.status === "completed" && !r.answered_at && !inbound;
              const Icon = inbound
                ? PhoneIncoming
                : missed
                ? PhoneMissed
                : Phone;
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        missed ? "text-destructive" : "text-muted-foreground"
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {fmtPhone(inbound ? r.from_number : r.to_number)}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {r.agent_name ?? "—"}
                        {dt
                          ? ` · ${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                          : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {outcomeBadge(r.outcome)}
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {fmtDuration(r.duration_seconds)}
                    </span>
                    {r.recording_url && (
                      <audio
                        controls
                        preload="none"
                        src={r.recording_url}
                        className="h-8 w-40"
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}