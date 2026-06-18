import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listGoals,
  upsertGoals,
  listSalesAgents,
  getGoalsConfig,
  setGoalsConfig,
  type GoalMetric,
  type GoalPeriod,
  type GoalRow,
} from "@/lib/goals.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Building2, Users, Save } from "lucide-react";

const PERIODS: { v: GoalPeriod; label: string }[] = [
  { v: "weekly", label: "Weekly" },
  { v: "monthly", label: "Monthly" },
  { v: "quarterly", label: "Quarterly" },
  { v: "yearly", label: "Yearly" },
];
const WEEKS_PER_MONTH = 52 / 12;
const METRICS: { v: GoalMetric; label: string; hint: string }[] = [
  { v: "policies", label: "Policies", hint: "# of policies sold" },
  { v: "items", label: "Items", hint: "# of items written" },
  { v: "premium", label: "Premium ($)", hint: "Total written premium" },
];

type Draft = Record<string, string>; // key = `${scope}|${agentId|''}|${period}|${metric}`

function keyOf(scope: "agency" | "agent", agentId: string | null, p: GoalPeriod, m: GoalMetric) {
  return `${scope}|${agentId ?? ""}|${p}|${m}`;
}

function buildDraft(goals: GoalRow[]): Draft {
  const d: Draft = {};
  for (const g of goals) {
    d[keyOf(g.scope, g.agent_id, g.period, g.metric)] = String(g.target);
  }
  return d;
}

export function GoalsSettings() {
  const qc = useQueryClient();
  const fetchGoals = useServerFn(listGoals);
  const fetchAgents = useServerFn(listSalesAgents);
  const save = useServerFn(upsertGoals);
  const saveConfig = useServerFn(setGoalsConfig);
  const fetchConfig = useServerFn(getGoalsConfig);

  const goalsQ = useQuery({
    queryKey: ["goals-list"],
    queryFn: () => fetchGoals(),
  });
  const configQ = useQuery({
    queryKey: ["goals-config"],
    queryFn: () => fetchConfig(),
  });
  const weeklyAuto = configQ.data?.weeklyAuto ?? true;
  const agentsQ = useQuery({
    queryKey: ["goals-sales-agents"],
    queryFn: () => fetchAgents(),
  });

  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string>("");

  useEffect(() => {
    if (goalsQ.data) setDraft(buildDraft(goalsQ.data.goals));
  }, [goalsQ.data]);

  const original = useMemo(
    () => (goalsQ.data ? buildDraft(goalsQ.data.goals) : {}),
    [goalsQ.data],
  );

  const dirty = useMemo(() => {
    const keys = new Set([...Object.keys(draft), ...Object.keys(original)]);
    for (const k of keys) {
      if ((draft[k] ?? "") !== (original[k] ?? "")) return true;
    }
    return false;
  }, [draft, original]);

  const agents = agentsQ.data?.agents ?? [];
  useEffect(() => {
    if (!selectedAgent && agents.length) setSelectedAgent(agents[0].id);
  }, [agents, selectedAgent]);

  const updateCell = (
    scope: "agency" | "agent",
    agentId: string | null,
    p: GoalPeriod,
    m: GoalMetric,
    value: string,
  ) => {
    setDraft((d) => ({ ...d, [keyOf(scope, agentId, p, m)]: value }));
  };

  const handleSave = async () => {
    const payload: {
      scope: "agency" | "agent";
      agentId: string | null;
      period: GoalPeriod;
      metric: GoalMetric;
      target: number;
    }[] = [];
    const keys = new Set([...Object.keys(draft), ...Object.keys(original)]);
    for (const k of keys) {
      if ((draft[k] ?? "") === (original[k] ?? "")) continue;
      const [scope, agentId, period, metric] = k.split("|") as [
        "agency" | "agent",
        string,
        GoalPeriod,
        GoalMetric,
      ];
      // Skip weekly edits when auto-derive is on — they would be ignored anyway.
      if (weeklyAuto && period === "weekly") continue;
      const raw = draft[k] ?? "";
      const num = raw === "" ? 0 : Number(raw);
      if (Number.isNaN(num) || num < 0) {
        toast.error("All targets must be non-negative numbers.");
        return;
      }
      payload.push({
        scope,
        agentId: scope === "agency" ? null : agentId || null,
        period,
        metric,
        target: num,
      });
    }
    if (payload.length === 0) return;
    setSaving(true);
    try {
      await save({ data: { goals: payload } });
      toast.success("Goals saved");
      await qc.invalidateQueries({ queryKey: ["goals-list"] });
      await qc.invalidateQueries({ queryKey: ["goal-progress"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const toggleAuto = async (v: boolean) => {
    try {
      await saveConfig({ data: { weeklyAuto: v } });
      toast.success(v ? "Weekly goals will auto-derive from monthly" : "Weekly goals are now manual");
      await qc.invalidateQueries({ queryKey: ["goals-config"] });
      await qc.invalidateQueries({ queryKey: ["goal-progress"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update setting");
    }
  };

  if (goalsQ.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading goals…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Goals</CardTitle>
        <CardDescription>
          Set sales targets for the whole agency and for individual agents.
          Set a target to 0 to clear it. Progress counts sold policies between
          the start of each period and now.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between rounded-lg border p-3 gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Auto-calculate weekly from monthly</Label>
            <p className="text-xs text-muted-foreground">
              When on, weekly targets = monthly ÷ {WEEKS_PER_MONTH.toFixed(2)} (≈ 4.33 weeks/month) and the weekly row is read-only.
            </p>
          </div>
          <Switch checked={weeklyAuto} onCheckedChange={toggleAuto} />
        </div>

        <Tabs defaultValue="agency">
          <TabsList>
            <TabsTrigger value="agency" className="gap-2">
              <Building2 className="h-4 w-4" /> Agency
            </TabsTrigger>
            <TabsTrigger value="agent" className="gap-2">
              <Users className="h-4 w-4" /> Individual agents
            </TabsTrigger>
          </TabsList>

          <TabsContent value="agency" className="mt-4">
            <GoalsGrid
              scope="agency"
              agentId={null}
              draft={draft}
              onChange={updateCell}
              weeklyAuto={weeklyAuto}
            />
          </TabsContent>

          <TabsContent value="agent" className="mt-4 space-y-4">
            <div className="flex items-center gap-3">
              <Label className="text-sm">Agent</Label>
              <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                <SelectTrigger className="w-[260px]">
                  <SelectValue placeholder="Select agent" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedAgent ? (
              <GoalsGrid
                scope="agent"
                agentId={selectedAgent}
                draft={draft}
                onChange={updateCell}
                weeklyAuto={weeklyAuto}
              />
            ) : (
              <div className="text-sm text-muted-foreground">No sales agents found.</div>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button
            variant="ghost"
            onClick={() => setDraft(original)}
            disabled={!dirty || saving}
          >
            Reset
          </Button>
          <Button onClick={handleSave} disabled={!dirty || saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save goals
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function GoalsGrid({
  scope,
  agentId,
  draft,
  onChange,
  weeklyAuto,
}: {
  scope: "agency" | "agent";
  agentId: string | null;
  draft: Draft;
  onChange: (
    scope: "agency" | "agent",
    agentId: string | null,
    p: GoalPeriod,
    m: GoalMetric,
    value: string,
  ) => void;
  weeklyAuto?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-separate border-spacing-y-2">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="w-32">Period</th>
            {METRICS.map((m) => (
              <th key={m.v} className="px-2">
                <div>{m.label}</div>
                <div className="text-[10px] font-normal normal-case text-muted-foreground/80">{m.hint}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERIODS.map((p) => (
            <tr key={p.v}>
              <td className="pr-2 align-middle text-sm font-medium">
                {p.label}
                {p.v === "weekly" && weeklyAuto && (
                  <span className="ml-2 text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                    auto
                  </span>
                )}
              </td>
              {METRICS.map((m) => {
                const k = `${scope}|${agentId ?? ""}|${p.v}|${m.v}`;
                if (p.v === "weekly" && weeklyAuto) {
                  const monthlyK = `${scope}|${agentId ?? ""}|monthly|${m.v}`;
                  const monthly = Number(draft[monthlyK] ?? 0) || 0;
                  const derived = monthly > 0 ? Math.round(monthly / (52 / 12)) : 0;
                  return (
                    <td key={m.v} className="px-2 align-middle">
                      <Input
                        type="number"
                        value={derived || ""}
                        disabled
                        placeholder="—"
                        className="bg-muted text-muted-foreground"
                      />
                    </td>
                  );
                }
                return (
                  <td key={m.v} className="px-2 align-middle">
                    <Input
                      type="number"
                      min={0}
                      step={m.v === "premium" ? "100" : "1"}
                      placeholder="0"
                      value={draft[k] ?? ""}
                      onChange={(e) =>
                        onChange(scope, agentId, p.v, m.v, e.target.value)
                      }
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}