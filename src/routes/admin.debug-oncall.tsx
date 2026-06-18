import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth, useHasRole } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { debugOnCall } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/debug-oncall")({
  head: () => ({
    meta: [
      { title: "On-Call Debug — LeadVault" },
      { name: "description", content: "Trace every step of the on-call computation." },
    ],
  }),
  component: DebugOnCallPage,
});

function DebugOnCallPage() {
  const { user, loading } = useAuth();
  const isAdmin = useHasRole("admin");
  const navigate = useNavigate();
  const fetchDebug = useServerFn(debugOnCall);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  const q = useQuery({
    queryKey: ["debug-oncall"],
    queryFn: () => fetchDebug(),
    enabled: !!user && isAdmin,
    refetchInterval: 10000,
  });

  if (loading || !user) return null;

  return (
    <AppShell>
      <PageHeader
        title="On-Call Debug"
        description="Step-by-step trace of how each agent's on-call status is computed."
      />
      {!isAdmin ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Admin access required.</CardContent>
        </Card>
      ) : q.isLoading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Running trace…</CardContent></Card>
      ) : q.error ? (
        <Card><CardContent className="p-6 text-sm text-destructive">{(q.error as Error).message}</CardContent></Card>
      ) : q.data ? (
        <div className="space-y-6">
          <Card>
            <CardContent className="p-6 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Run summary</h2>
                <Button size="sm" variant="outline" onClick={() => q.refetch()}>Re-run</Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Stat label="On call" value={q.data.counts.on_call} />
                <Stat label="Agents" value={q.data.counts.agents} />
                <Stat label="leads rows" value={q.data.counts.leads_rows} />
                <Stat label="list_leads rows" value={q.data.counts.list_leads_rows} />
                <Stat label="Recent activities" value={q.data.counts.recent_activities} />
                <Stat label="Sales+admin IDs" value={q.data.counts.sales_admin_ids} />
                <Stat label="Side traces" value={q.data.side_traces_total} />
                <Stat label="Generated" value={new Date(q.data.generated_at).toLocaleTimeString()} />
              </div>
              <div className="pt-2 text-xs text-muted-foreground">
                Claim freshness cutoff (6h): <code>{q.data.config.onCallSinceIso}</code>
                <br />
                Call freshness cutoff (15m): <code>{q.data.config.callSinceIso}</code>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6 space-y-2">
              <h2 className="text-base font-semibold">Computation log</h2>
              <pre className="bg-muted rounded p-3 text-xs overflow-auto max-h-64">
                {q.data.log.join("\n")}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6 space-y-3">
              <h2 className="text-base font-semibold">Per-agent result</h2>
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground border-b">
                    <tr className="text-left">
                      <th className="py-2 pr-3">Agent</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Reasons</th>
                      <th className="py-2 pr-3">Claim lead</th>
                      <th className="py-2 pr-3">Claim stamp</th>
                      <th className="py-2 pr-3">Initiated</th>
                      <th className="py-2 pr-3">Last active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.agents.map((a) => (
                      <tr key={a.id} className="border-b last:border-b-0">
                        <td className="py-2 pr-3 font-medium">{a.name}</td>
                        <td className="py-2 pr-3">
                          {a.on_call ? (
                            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">on call</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {a.reasons.length ? a.reasons.join(" + ") : "—"}
                        </td>
                        <td className="py-2 pr-3 font-mono">{a.claim_lead_id ?? "—"}</td>
                        <td className="py-2 pr-3 font-mono">{a.claim_stamp ?? "—"}</td>
                        <td className="py-2 pr-3 font-mono">{a.initiated_lead_id ?? "—"}</td>
                        <td className="py-2 pr-3 font-mono">{a.last_active_at ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6 space-y-3">
              <h2 className="text-base font-semibold">
                Side traces (showing {q.data.side_traces_sample.length} of {q.data.side_traces_total})
              </h2>
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground border-b">
                    <tr className="text-left">
                      <th className="py-2 pr-3">Decision</th>
                      <th className="py-2 pr-3">Agent</th>
                      <th className="py-2 pr-3">Table</th>
                      <th className="py-2 pr-3">Side</th>
                      <th className="py-2 pr-3">Stamp</th>
                      <th className="py-2 pr-3">Dispo</th>
                      <th className="py-2 pr-3">Reason</th>
                      <th className="py-2 pr-3">Lead</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.side_traces_sample.map((t, i) => (
                      <tr key={i} className="border-b last:border-b-0">
                        <td className="py-2 pr-3">
                          <Badge
                            variant="outline"
                            className={
                              t.decision === "on_call"
                                ? "border-emerald-500/40 text-emerald-300"
                                : t.decision === "skipped_stale"
                                  ? "border-amber-500/40 text-amber-300"
                                  : "border-muted text-muted-foreground"
                            }
                          >
                            {t.decision}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3">{t.agent_name ?? "—"}</td>
                        <td className="py-2 pr-3">{t.table}</td>
                        <td className="py-2 pr-3">{t.side}</td>
                        <td className="py-2 pr-3 font-mono">{t.stamp ?? "—"}</td>
                        <td className="py-2 pr-3">{t.dispo ?? "—"}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{t.reason}</td>
                        <td className="py-2 pr-3 font-mono">{t.lead_id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border bg-card/50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}