import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getAiPinnedInsights, getAiAlerts } from "@/lib/ai-context.functions";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, Pin, Lightbulb } from "lucide-react";

const SUGGESTED = [
  "Which agents are off-pace this week?",
  "Which vendor has the best ROI this month?",
  "Show me leads neglected in the last 48 hours.",
  "What changed this week vs last week?",
  "Project this month's premium.",
];

export function AIInsightsPanel({ onAsk }: { onAsk: (q: string) => void }) {
  const pin = useServerFn(getAiPinnedInsights);
  const al = useServerFn(getAiAlerts);
  const pins = useQuery({ queryKey: ["ai_pinned"], queryFn: () => pin() });
  const alerts = useQuery({ queryKey: ["ai_alerts"], queryFn: () => al() });

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-xs">
      <Section icon={<Lightbulb className="h-3.5 w-3.5 text-primary" />} title="Try asking">
        <div className="flex flex-col gap-1">
          {SUGGESTED.map((s) => (
            <button
              key={s}
              onClick={() => onAsk(s)}
              className="rounded-md border border-border/40 bg-card/40 px-2 py-1.5 text-left text-[11px] hover:border-primary/40 hover:bg-primary/5"
            >
              {s}
            </button>
          ))}
        </div>
      </Section>

      <Section icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-400" />} title={`Alerts (${alerts.data?.length ?? 0})`}>
        {alerts.data?.length ? (
          alerts.data.map((a: any) => (
            <Card key={a.id} className="border-amber-500/20 bg-amber-500/5">
              <CardContent className="p-2">
                <div className="font-medium text-amber-200">{a.title}</div>
                <div className="text-[10px] text-muted-foreground">{a.severity}</div>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="text-[11px] text-muted-foreground">No active alerts.</div>
        )}
      </Section>

      <Section icon={<Pin className="h-3.5 w-3.5 text-primary" />} title={`Pinned (${pins.data?.length ?? 0})`}>
        {pins.data?.length ? (
          pins.data.map((p: any) => (
            <Card key={p.id} className="border-border/40">
              <CardContent className="p-2">
                <div className="font-medium">{p.title}</div>
                <div className="line-clamp-3 text-[11px] text-muted-foreground">{p.body?.text}</div>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="text-[11px] text-muted-foreground">Nothing pinned yet.</div>
        )}
      </Section>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}{title}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}