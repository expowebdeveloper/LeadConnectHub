import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth, useHasRole } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, DollarSign } from "lucide-react";
import { toast } from "sonner";
import {
  getCommissionsOverview,
  getMyCommissions,
  setAgentType,
} from "@/lib/commission-hub.functions";
import { fmtMoney, fmtPct, type AgentType } from "@/lib/commissions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function previousMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(m: string) {
  const [y, mm] = m.split("-").map(Number);
  return new Date(y, mm - 1, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function MonthScope({
  month,
  onChange,
  availableMonths,
}: {
  month: string | null;
  onChange: (m: string | null) => void;
  availableMonths: string[];
}) {
  const cur = currentMonth();
  const prev = previousMonth();
  const options = useMemo(() => {
    const set = new Set<string>([cur, prev, ...availableMonths]);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [availableMonths, cur, prev]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant={month === cur ? "default" : "outline"}
        onClick={() => onChange(cur)}
      >
        Current month
      </Button>
      <Button
        size="sm"
        variant={month === prev ? "default" : "outline"}
        onClick={() => onChange(prev)}
      >
        Previous month
      </Button>
      <Button
        size="sm"
        variant={month === null ? "default" : "outline"}
        onClick={() => onChange(null)}
      >
        All time
      </Button>
      <select
        value={month ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="">All time</option>
        {options.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
          </option>
        ))}
      </select>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <Card className={accent ? "bg-primary text-primary-foreground" : ""}>
      <CardContent className="p-5">
        <div
          className={`flex items-center justify-between text-sm font-medium ${accent ? "opacity-80" : "text-muted-foreground"}`}
        >
          <span>{label}</span>
          {icon}
        </div>
        <div className="mt-2 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function MyCommissions() {
  const { user } = useAuth();
  const fetchMine = useServerFn(getMyCommissions);
  const [month, setMonth] = useState<string | null>(currentMonth());

  const q = useQuery({
    queryKey: ["my-commissions", user?.id, month],
    queryFn: () => fetchMine({ data: { month } }),
    enabled: !!user,
  });

  if (q.isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          Loading…
        </CardContent>
      </Card>
    );
  }
  if (q.error) {
    return (
      <Card>
        <CardContent className="p-6 text-destructive">
          {(q.error as Error).message}
        </CardContent>
      </Card>
    );
  }

  const data = q.data!;
  const { profile, summary, rows, availableMonths } = data;

  const typeLabel =
    profile?.agent_type === "homie"
      ? "Homie"
      : profile?.agent_type === "autobot"
        ? "Autobot"
        : profile?.agent_type === "service"
          ? "Service"
          : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm text-muted-foreground">
            {typeLabel ? `${typeLabel} plan` : "No commission plan assigned"}
          </div>
          <div className="text-lg font-medium">
            {profile?.full_name || profile?.email}
          </div>
        </div>
        <MonthScope
          month={month}
          onChange={setMonth}
          availableMonths={availableMonths ?? []}
        />
      </div>

      {!profile?.agent_type && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Ask an admin to assign you a commission plan (Homie / Autobot /
            Service) from the Team overview tab.
          </CardContent>
        </Card>
      )}

      {summary && summary.type === "homie" && (
        <div className="grid gap-4 md:grid-cols-3">
          <Stat
            label="Commission"
            value={fmtMoney(summary.commission)}
            accent
            icon={<DollarSign className="h-4 w-4" />}
          />
          <Stat
            label="Tier commission"
            value={fmtMoney(summary.tierCommission)}
          />
          <Stat
            label="Allstate bonus"
            value={fmtMoney(summary.allstateBonus)}
          />
          <Stat label="Commissionable base" value={fmtMoney(summary.base)} />
          <Stat
            label={`Tier ${summary.tierLabel}`}
            value={fmtPct(summary.rate)}
          />
          <Stat
            label="Allstate items (mono / bundle)"
            value={`${summary.allstateMonolineItems} / ${summary.allstateBundledItems}`}
          />
          <Card className="md:col-span-3">
            <CardContent className="p-5">
              <div className="mb-2 flex justify-between text-sm">
                <span>Tier progress</span>
                <span className="text-muted-foreground">
                  {summary.nextThreshold
                    ? `${fmtMoney(summary.nextThreshold - summary.base)} to next tier`
                    : "Top tier reached"}
                </span>
              </div>
              <Progress
                value={
                  summary.nextThreshold
                    ? (summary.base / summary.nextThreshold) * 100
                    : 100
                }
              />
              <div className="mt-2 text-xs text-muted-foreground">
                Total premium {fmtMoney(summary.totalPremium)} · excludes
                Allstate Auto {fmtMoney(summary.allstateAutoPremium)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {summary && summary.type === "autobot" && (
        <div className="grid gap-4 md:grid-cols-3">
          <Stat
            label="Total commission"
            value={fmtMoney(summary.commission)}
            accent
            icon={<DollarSign className="h-4 w-4" />}
          />
          <Stat
            label={`Allstate (${fmtPct(summary.allstateRate)})`}
            value={fmtMoney(summary.allstateCommission)}
          />
          <Stat
            label="Non-Allstate (4%)"
            value={fmtMoney(summary.nonAllstateCommission)}
          />
          <Stat
            label={`Club bonus${summary.clubLabel ? ` — ${summary.clubLabel}` : ""}`}
            value={fmtMoney(summary.clubBonus)}
          />
          <Stat
            label="Allstate auto items"
            value={String(summary.allstateAutoItems)}
          />
          <Stat
            label="Allstate other items"
            value={String(summary.allstateOtherItems)}
          />
        </div>
      )}

      {summary && summary.type === "service" && (
        <div className="grid gap-4 md:grid-cols-3">
          <Stat
            label="Total commission"
            value={fmtMoney(summary.commission)}
            accent
            icon={<DollarSign className="h-4 w-4" />}
          />
          <Stat
            label="Allstate commission (2% or $20 min)"
            value={fmtMoney(summary.allstateCommission)}
          />
          <Stat
            label="Non-Allstate commission (2%)"
            value={fmtMoney(summary.nonAllstateCommission)}
          />
          <Stat label="Total premium" value={fmtMoney(summary.totalPremium)} />
          <Stat
            label="Allstate premium"
            value={fmtMoney(summary.allstatePremium)}
          />
          <Stat
            label="$20 minimum applied"
            value={`${summary.allstateMinApplied} policies`}
          />
        </div>
      )}

      {summary &&
        (summary.type === "homie" || summary.type === "autobot") &&
        summary.nextTier && (
          <Card>
            <CardContent className="p-5">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                What if you hit the next tier?
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <div className="text-2xl font-semibold">
                  {fmtMoney(summary.nextTier.projectedCommission)}
                </div>
                <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  +{fmtMoney(summary.nextTier.delta)}
                </div>
                <div className="text-sm text-muted-foreground">
                  at {summary.nextTier.tierLabel} — need{" "}
                  {summary.nextTier.needLabel}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-5 py-3 font-medium">
            Sold policies ({rows.length})
            {month ? ` — ${monthLabel(month)}` : " — all time"}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Side</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Premium</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.leadId}-${r.side}`}>
                  <TableCell>{r.written_at?.slice(0, 10) ?? "—"}</TableCell>
                  <TableCell className="capitalize">{r.side}</TableCell>
                  <TableCell>{r.policy.carrier ?? "—"}</TableCell>
                  <TableCell>{r.policy.product ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {fmtMoney(Number(r.policy.premium))}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-10 text-center text-muted-foreground"
                  >
                    No sold policies in this period.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function PlanSelect({
  value,
  onChange,
  disabled,
}: {
  value: AgentType | null;
  onChange: (v: AgentType | null) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value ?? "none"}
      onValueChange={(v) =>
        onChange(v === "none" ? null : (v as AgentType))
      }
      disabled={disabled}
    >
      <SelectTrigger className="h-8 w-[140px]">
        <SelectValue placeholder="Pick a plan" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No plan</SelectItem>
        <SelectItem value="homie">Homie</SelectItem>
        <SelectItem value="autobot">Autobot</SelectItem>
        <SelectItem value="service">Service</SelectItem>
      </SelectContent>
    </Select>
  );
}

function TeamOverview() {
  const fetchOverview = useServerFn(getCommissionsOverview);
  const update = useServerFn(setAgentType);
  const qc = useQueryClient();
  const [month, setMonth] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["commissions-overview", month],
    queryFn: () => fetchOverview({ data: { month } }),
  });

  const save = useMutation({
    mutationFn: (input: { userId: string; agentType: AgentType | null }) =>
      update({ data: input }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["commissions-overview"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Could not save"),
  });

  if (q.isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          Loading…
        </CardContent>
      </Card>
    );
  }
  if (q.error) {
    return (
      <Card>
        <CardContent className="p-6 text-destructive">
          {(q.error as Error).message}
        </CardContent>
      </Card>
    );
  }

  const data = q.data!;
  const { agents, unassigned, totals, availableMonths } = data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <MonthScope
          month={month}
          onChange={setMonth}
          availableMonths={availableMonths ?? []}
        />
        <div className="text-sm text-muted-foreground">
          {totals.policyCount} sold policies · {totals.agentCount} agents on a
          plan
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="Agents on plan" value={String(totals.agentCount)} />
        <Stat label="Total premium" value={fmtMoney(totals.totalPremium)} />
        <Stat
          label="Total commission"
          value={fmtMoney(totals.totalCommission)}
          accent
          icon={<DollarSign className="h-4 w-4" />}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-5 py-3 font-medium">Leaderboard</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Policies</TableHead>
                <TableHead className="text-right">Premium</TableHead>
                <TableHead className="text-right">Commission</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((a) => (
                <TableRow key={a.userId}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <AgentAvatar name={a.displayName} path={a.avatarPath} size="md" />
                      <div>
                        <div className="font-medium">{a.displayName}</div>
                        <div className="text-xs text-muted-foreground">
                          {a.email}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <PlanSelect
                      value={a.agentType}
                      onChange={(v) =>
                        save.mutate({ userId: a.userId, agentType: v })
                      }
                      disabled={save.isPending}
                    />
                  </TableCell>
                  <TableCell className="text-right">{a.policyCount}</TableCell>
                  <TableCell className="text-right">
                    {fmtMoney(a.totalPremium)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {fmtMoney(a.commission)}
                  </TableCell>
                </TableRow>
              ))}
              {agents.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-10 text-center text-muted-foreground"
                  >
                    No agents on a commission plan yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {unassigned.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="border-b px-5 py-3">
              <div className="font-medium">Sold leads — no plan assigned</div>
              <div className="text-xs text-muted-foreground">
                These users have sold leads but don't yet have a commission
                plan. Pick one to add them to the leaderboard.
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Policies</TableHead>
                  <TableHead className="text-right">Premium</TableHead>
                  <TableHead>Assign plan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unassigned.map((u) => (
                  <TableRow key={u.userId}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <AgentAvatar name={u.displayName} path={u.avatarPath} size="md" />
                        {u.displayName}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {u.policyCount}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtMoney(u.totalPremium)}
                    </TableCell>
                    <TableCell>
                      <PlanSelect
                        value={null}
                        onChange={(v) =>
                          save.mutate({ userId: u.userId, agentType: v })
                        }
                        disabled={save.isPending}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function CommissionsPanel() {
  const isAdmin = useHasRole("admin");
  return (
    <div className="space-y-4">
      <Alert className="border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Estimates only — not 100% accurate</AlertTitle>
        <AlertDescription>
          Numbers are computed live from sold leads. Until we record the
          sold-to carrier and an exact bind date per policy, calculations
          assume every sold policy is written with Allstate, count each side
          as 1 item, and use the lead's last-updated date as the written
          date. Use this for direction, not for payroll.
        </AlertDescription>
      </Alert>

      {isAdmin ? (
        <Tabs defaultValue="mine" className="w-full">
          <TabsList>
            <TabsTrigger value="mine">My commissions</TabsTrigger>
            <TabsTrigger value="team">Team overview</TabsTrigger>
          </TabsList>
          <TabsContent value="mine" className="mt-4">
            <MyCommissions />
          </TabsContent>
          <TabsContent value="team" className="mt-4">
            <TeamOverview />
          </TabsContent>
        </Tabs>
      ) : (
        <MyCommissions />
      )}
    </div>
  );
}
