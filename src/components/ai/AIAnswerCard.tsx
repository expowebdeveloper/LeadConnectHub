import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function formatVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString();
  if (typeof v === "string") return v;
  return String(v);
}

export function ToolResultCard({ name, output }: { name: string; output: unknown }) {
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, any>;

  // KPI snapshot
  if (name === "getKpiSnapshot") {
    const kpis: Array<[string, unknown]> = [
      ["New leads", o.leads_new],
      ["Claimed", o.leads_claimed],
      ["Calls", o.calls],
      ["Sales", o.sales],
      ["Premium", `$${Number(o.premium ?? 0).toLocaleString()}`],
      ["Close rate", o.close_rate != null ? `${(o.close_rate * 100).toFixed(1)}%` : "—"],
    ];
    return (
      <Card className="border-primary/30 bg-card/60">
        <CardContent className="p-3">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">KPI · {o.range}</div>
          <div className="grid grid-cols-3 gap-2">
            {kpis.map(([k, v]) => (
              <div key={k} className="rounded-md border border-border/60 bg-background/40 p-2">
                <div className="text-[10px] text-muted-foreground">{k}</div>
                <div className="text-sm font-semibold text-foreground">{formatVal(v)}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Projection
  if (name === "getProjection") {
    return (
      <Card className="border-primary/30 bg-card/60">
        <CardContent className="space-y-2 p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Forecast · {o.kind}</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-muted-foreground">MTD: </span><b>{formatVal(o.mtd)}</b></div>
            <div><span className="text-muted-foreground">Projected EOM: </span><b>{formatVal(o.projected_eom)}</b></div>
            <div><span className="text-muted-foreground">Pace/day: </span>{formatVal(o.pace_per_business_day)}</div>
            <div><span className="text-muted-foreground">Confidence: </span>{o.confidence}</div>
            {o.goal != null && <div><span className="text-muted-foreground">Goal: </span><b>{formatVal(o.goal)}</b></div>}
            {o.gap_to_goal != null && (
              <div className={cn(o.gap_to_goal > 0 ? "text-amber-400" : "text-emerald-400")}>
                {o.gap_to_goal > 0 ? "Short by" : "Ahead by"} {formatVal(Math.abs(o.gap_to_goal))}
              </div>
            )}
            {o.per_business_day_needed != null && (
              <div><span className="text-muted-foreground">Need/day: </span>{formatVal(o.per_business_day_needed)}</div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Tabular: agents / vendors / leads / sources
  const tableKey = ["agents", "vendors", "leads", "sources", "alerts"].find((k) => Array.isArray(o[k]));
  if (tableKey) {
    const rows = o[tableKey] as Record<string, any>[];
    if (!rows.length) {
      return <div className="text-xs text-muted-foreground">No {tableKey} found.</div>;
    }
    const cols = Object.keys(rows[0]).filter((c) => !c.endsWith("_id")).slice(0, 7);
    return (
      <Card className="border-border/60">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  {cols.map((c) => <th key={c} className="px-2 py-1.5 text-left font-medium">{c.replace(/_/g, " ")}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((r, i) => (
                  <tr key={i} className="border-t border-border/40">
                    {cols.map((c) => (
                      <td key={c} className="px-2 py-1.5">{formatVal(r[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <pre className="overflow-auto rounded-md border border-border/40 bg-muted/20 p-2 text-[11px] text-muted-foreground">
      {JSON.stringify(o, null, 2).slice(0, 1200)}
    </pre>
  );
}