import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth, useHasRole } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { getAnalytics } from "@/lib/analytics.functions";
import { getHubStats, type AgentTally } from "@/lib/hub-stats.functions";
import { getGoalProgress, type GoalMetric, type GoalPeriod } from "@/lib/goals.functions";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { PhoneLink } from "@/components/PhoneLink";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Shield,
  CalendarDays,
  BarChart3,
  ArrowRight,
  Clock,
  Trophy,
  Target,
  DollarSign,
  CalendarClock,
  ClipboardList,
  Flame,
  Zap,
} from "lucide-react";
import { formatSpeed } from "@/lib/speed-to-claim";
import { formatUnclaimedRate, unclaimedRateColor } from "@/lib/unclaimed-rate";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LeadVault — Insurance Lead CRM" },
      { name: "description", content: "Vendor lead intake and sales agent CRM for call-center leads." },
    ],
  }),
  component: Index,
});

function Index() {
  const { user, loading, roles } = useAuth();
  const isSales = useHasRole("sales", "admin");
  const isVendor = useHasRole("vendor");
  const isTelemarketer = useHasRole("telemarketer");
  const isTelemarketerOnly = isTelemarketer && !isSales && !isVendor;
  const navigate = useNavigate();
  const isPending = roles.length === 1 && roles[0] === "pending";

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/auth", replace: true });
      return;
    }
    if (isTelemarketerOnly) {
      navigate({ to: "/call-queue", replace: true });
      return;
    }
    if (!isSales && isVendor) {
      navigate({ to: "/liveleads", replace: true });
    }
  }, [user, loading, isSales, isVendor, isTelemarketerOnly, navigate]);

  if (loading || !user || (!isSales && isVendor)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Shield className="h-8 w-8 animate-pulse text-primary" />
      </div>
    );
  }

  if (isPending) {
    return (
      <AppShell>
        <PageHeader title="Welcome to LeadVault" />
        <Card className="mx-auto max-w-2xl">
          <CardContent className="space-y-2 pt-6">
            <h2 className="text-lg font-semibold">Awaiting approval</h2>
            <p className="text-sm text-muted-foreground">
              Your account has been created. An admin needs to assign you a
              role before you can use LeadVault.
            </p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <SalesHub uid={user.id} />
    </AppShell>
  );
}

type Period = "today" | "week" | "month";

function periodLabel(p: Period) {
  return p === "today" ? "Today" : p === "week" ? "This Week" : "This Month";
}

function SalesHub({ uid }: { uid: string }) {
  const [period, setPeriod] = useState<Period>("month");
  const queryClient = useQueryClient();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Live updates: when a lead changes (sold, dispo, claim, etc.) or a new
  // sale event is recorded, refresh the leaderboard + hub stats so the
  // dashboard reflects activity in real time.
  useEffect(() => {
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ["hub-analytics"] });
      queryClient.invalidateQueries({ queryKey: ["hub-stats"] });
      queryClient.invalidateQueries({ queryKey: ["hub-my-goals"] });
      queryClient.invalidateQueries({ queryKey: ["hub-agency-goals"] });
    };
    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "list_leads" }, invalidate)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sale_events" }, invalidate)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const todayQ = useQuery({
    queryKey: ["hub-today", uid, period],
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      if (period === "today") {
        end.setDate(end.getDate() + 1);
      } else if (period === "week") {
        start.setDate(start.getDate() - start.getDay());
        end.setTime(start.getTime());
        end.setDate(end.getDate() + 7);
      } else {
        start.setDate(1);
        end.setTime(start.getTime());
        end.setMonth(end.getMonth() + 1);
      }
      const [live, list] = await Promise.all([
        supabase
          .from("leads")
          .select("id, first_name, last_name, phone, follow_up_at")
          .eq("dispo", "follow_up")
          .gte("follow_up_at", start.toISOString())
          .lt("follow_up_at", end.toISOString())
          .or(`claimed_by.eq.${uid},agent_id.eq.${uid}`),
        supabase
          .from("list_leads")
          .select("id, first_name, last_name, phone, follow_up_at")
          .eq("dispo", "follow_up")
          .gte("follow_up_at", start.toISOString())
          .lt("follow_up_at", end.toISOString())
          .or(`claimed_by.eq.${uid},agent_id.eq.${uid}`),
      ]);
      if (live.error) throw live.error;
      if (list.error) throw list.error;
      return [...(live.data ?? []), ...(list.data ?? [])].sort(
        (a, b) =>
          new Date(a.follow_up_at as string).getTime() -
          new Date(b.follow_up_at as string).getTime(),
      );
    },
  });

  const fetchStats = useServerFn(getHubStats);
  const statsQ = useQuery({
    queryKey: ["hub-stats", uid, period, tz],
    queryFn: () => fetchStats({ data: { period, tz } }),
    retry: false,
  });

  const fetchAnalytics = useServerFn(getAnalytics);
  const analyticsQ = useQuery({
    queryKey: ["hub-analytics", tz],
    queryFn: () => fetchAnalytics({ data: { tz } }),
    retry: false,
  });

  const fetchGoals = useServerFn(getGoalProgress);
  const goalsQ = useQuery({
    queryKey: ["hub-my-goals", uid],
    queryFn: () => fetchGoals({ data: { scope: "agent", agentId: uid } }),
    retry: false,
  });
  const agencyGoalsQ = useQuery({
    queryKey: ["hub-agency-goals"],
    queryFn: () => fetchGoals({ data: { scope: "agency", agentId: null } }),
    retry: false,
  });

  const leaderboard = analyticsQ.data?.activityByWindow?.[period] ?? [];

  return (
    <div className="relative">
        <PageHeader
          title="LeadVault"
          description="Your snapshot — pipeline, rank, and what's on deck."
          action={
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">View</span>
              <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                <SelectTrigger className="h-8 w-32 border-border bg-muted/60 text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Daily</SelectItem>
                  <SelectItem value="week">Weekly</SelectItem>
                  <SelectItem value="month">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          }
        />

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <CombinedGoalsTile
          myRows={goalsQ.data?.progress ?? []}
          myLoading={goalsQ.isLoading}
          agencyRows={agencyGoalsQ.data?.progress ?? []}
          agencyLoading={agencyGoalsQ.isLoading}
          period={period}
        />

        <WidgetCard
          to="/analytics"
          label={`Sales Leaderboard — ${periodLabel(period)}`}
          icon={<Trophy className="h-4 w-4" />}
          accent="emerald"
        >
          <SalesLeaderboardPreview
            rows={
              period === "today"
                ? analyticsQ.data?.topAgentsDay ?? []
                : period === "week"
                  ? analyticsQ.data?.topAgentsWeek ?? []
                  : analyticsQ.data?.topAgentsMonth ?? []
            }
            loading={analyticsQ.isLoading}
            error={!!analyticsQ.error}
            meId={uid}
            period={period}
          />
        </WidgetCard>

        <WidgetCard
          to="/follow-ups"
          label={`Calendar — ${periodLabel(period)}`}
          icon={<CalendarDays className="h-4 w-4" />}
          accent="amber"
        >
          <CalendarPreview
            rows={todayQ.data ?? []}
            loading={todayQ.isLoading}
            period={period}
          />
        </WidgetCard>

        <WidgetCard
          to="/analytics"
          label={`Activity Leaderboard — ${periodLabel(period)}`}
          icon={<BarChart3 className="h-4 w-4" />}
          accent="indigo"
        >
          <ActivityPreview
            rows={leaderboard}
            loading={analyticsQ.isLoading}
            error={!!analyticsQ.error}
            meId={uid}
          />
        </WidgetCard>
      </div>
      </div>
  );
}

const ACCENTS: Record<string, { bar: string; icon: string }> = {
  emerald: { bar: "bg-emerald-500/60", icon: "bg-emerald-500/15 text-emerald-300" },
  indigo: { bar: "bg-indigo-500/60", icon: "bg-indigo-500/15 text-indigo-300" },
  amber: { bar: "bg-amber-500/60", icon: "bg-amber-500/15 text-amber-300" },
  violet: { bar: "bg-violet-500/60", icon: "bg-violet-500/15 text-violet-300" },
  rose: { bar: "bg-rose-500/60", icon: "bg-rose-500/15 text-rose-300" },
  cyan: { bar: "bg-cyan-500/60", icon: "bg-cyan-500/15 text-cyan-300" },
};


function CombinedGoalsTile({
  myRows,
  myLoading,
  agencyRows,
  agencyLoading,
  period,
}: {
  myRows: Array<{ period: GoalPeriod; metric: GoalMetric; target: number; actual: number }>;
  myLoading: boolean;
  agencyRows: Array<{ period: GoalPeriod; metric: GoalMetric; target: number; actual: number }>;
  agencyLoading: boolean;
  period: Period;
}) {
  const a = ACCENTS.rose;
  return (
    <Card className="relative h-full overflow-hidden border-border bg-card text-foreground backdrop-blur">
      <div className={`absolute inset-x-0 top-0 h-0.5 ${a.bar}`} />
      <CardContent className="relative p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`rounded-md p-1.5 ${a.icon}`}>
              <Target className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-foreground">
              Goals
            </span>
          </div>
          <Link
            to="/analytics"
            className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
          >
            View <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </div>
        <Tabs defaultValue="me" className="w-full">
          <TabsList className="mb-3 grid w-full grid-cols-2 bg-muted/60">
            <TabsTrigger value="me" className="data-[state=active]:bg-accent/30">
              <Target className="mr-1.5 h-3.5 w-3.5" /> Mine
            </TabsTrigger>
            <TabsTrigger value="agency" className="data-[state=active]:bg-accent/30">
              <Flame className="mr-1.5 h-3.5 w-3.5" /> Agency
            </TabsTrigger>
          </TabsList>
          <TabsContent value="me">
            <GoalsPreview rows={myRows} loading={myLoading} period={period} />
          </TabsContent>
          <TabsContent value="agency">
            <GoalsPreview rows={agencyRows} loading={agencyLoading} period={period} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function WidgetCard({
  to,
  label,
  icon,
  accent,
  children,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
  accent: keyof typeof ACCENTS;
  children: React.ReactNode;
}) {
  const a = ACCENTS[accent];
  return (
    <Link
      to={to}
      className="group block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="relative h-full overflow-hidden border-border bg-card text-foreground backdrop-blur transition-all group-hover:-translate-y-0.5 group-hover:border-border group-hover:shadow-md">
        <div className={`absolute inset-x-0 top-0 h-0.5 ${a.bar}`} />
        <CardContent className="relative p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`rounded-md p-1.5 ${a.icon}`}>{icon}</div>
              <span className="text-sm font-semibold tracking-tight text-foreground">
                {label}
              </span>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </div>
          {children}
        </CardContent>
      </Card>
    </Link>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function PipelinePreview({
  stats,
  loading,
  error,
}: {
  stats:
    | {
        me: AgentTally;
        ranks: { leads: number | null; quotes: number | null; followUps: number | null; xDates: number | null; speed: number | null; unclaimed: number | null; total: number };
        teamUnclaimedRate?: number;
      }
    | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) return <Empty>Loading…</Empty>;
  if (error || !stats) return <Empty>Stats unavailable</Empty>;

  const rows: Array<{
    key: string;
    label: string;
    icon: React.ReactNode;
    value: number | string;
    rank: number | null;
    sub?: string;
    valueClassName?: string;
  }> = [
    { key: "leads", label: "Leads claimed", icon: <ClipboardList className="h-3.5 w-3.5" />, value: stats.me.leads, rank: stats.ranks.leads },
    { key: "quotes", label: "Quotes", icon: <DollarSign className="h-3.5 w-3.5" />, value: stats.me.quotes, rank: stats.ranks.quotes },
    { key: "follow", label: "Follow-ups", icon: <Clock className="h-3.5 w-3.5" />, value: stats.me.followUps, rank: stats.ranks.followUps },
    { key: "xdates", label: "X-Dates", icon: <CalendarClock className="h-3.5 w-3.5" />, value: stats.me.xDates, rank: stats.ranks.xDates },
    {
      key: "speed",
      label: "Avg claim time",
      icon: <Zap className="h-3.5 w-3.5" />,
      value: formatSpeed(stats.me.speedToClaim.avgSec),
      rank: stats.ranks.speed,
      sub:
        stats.me.speedToClaim.samples > 0
          ? `Best ${formatSpeed(stats.me.speedToClaim.bestSec)}`
          : undefined,
    },
    {
      key: "unclaimed",
      label: "Unclaimed rate",
      icon: <Flame className="h-3.5 w-3.5" />,
      value:
        stats.me.unclaimed.eligibleEvents > 0
          ? formatUnclaimedRate(stats.me.unclaimed.rate)
          : "—",
      rank: stats.ranks.unclaimed,
      sub:
        stats.me.unclaimed.eligibleEvents > 0
          ? `${stats.me.unclaimed.missedEvents}/${stats.me.unclaimed.eligibleEvents} eligible · team ${formatUnclaimedRate(stats.teamUnclaimedRate ?? 0)}`
          : "No eligible pops yet",
      valueClassName:
        stats.me.unclaimed.eligibleEvents > 0
          ? unclaimedRateColor(stats.me.unclaimed.rate)
          : undefined,
    },
  ];
  const total = stats.ranks.total;

  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
          <li
            key={r.key}
            className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2"
          >
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{r.icon}</span>
              <div className="flex flex-col">
                <span className="text-foreground">{r.label}</span>
                {r.sub && <span className="text-[10px] text-muted-foreground">{r.sub}</span>}
              </div>
            </div>
          <div className="flex items-center gap-3">
            <span className={`text-lg font-semibold tabular-nums ${r.valueClassName ?? ""}`}>{r.value}</span>
            <RankBadge rank={r.rank} total={total} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function RankBadge({ rank, total }: { rank: number | null; total: number }) {
  if (!rank || total === 0) {
    return (
      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        unranked
      </span>
    );
  }
  const tone =
    rank === 1
      ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
      : rank <= 3
        ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
        : "border-border bg-muted/60 text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {rank === 1 && <Trophy className="h-3 w-3" />}
      #{rank}
      <span className="opacity-60">/ {total}</span>
    </span>
  );
}

function CalendarPreview({
  rows,
  loading,
  period,
}: {
  rows: Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    follow_up_at: string | null;
  }>;
  loading: boolean;
  period: Period;
}) {
  if (loading) return <Empty>Loading…</Empty>;
  if (rows.length === 0)
    return (
      <Empty>
        Nothing scheduled {period === "today" ? "today" : `this ${period}`}
      </Empty>
    );
  const preview = rows.slice(0, 5);
  return (
    <ul className="space-y-1.5">
      {preview.map((r) => (
        <li
          key={r.id}
          className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="font-mono text-xs text-muted-foreground">
              {r.follow_up_at
                ? new Date(r.follow_up_at).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "—"}
            </span>
            <span className="truncate">
              {r.first_name} {r.last_name}
            </span>
          </div>
          {r.phone && (
            <PhoneLink
              phone={r.phone}
              className="hidden text-xs sm:inline-flex"
              stopPropagation={false}
              leadId={r.id}
              leadSource="live"
              nested
            />
          )}
        </li>
      ))}
      {rows.length > 5 && (
        <li className="text-center text-xs text-muted-foreground">
          + {rows.length - 5} more today
        </li>
      )}
    </ul>
  );
}

function ActivityPreview({
  rows,
  loading,
  error,
  meId,
}: {
  rows: Array<{ id: string; name: string; avatarPath?: string | null; score: number }>;
  loading: boolean;
  error: boolean;
  meId: string;
}) {
  if (loading) return <Empty>Loading…</Empty>;
  if (error) return <Empty>Analytics unavailable</Empty>;
  if (rows.length === 0) return <Empty>No activity yet in this window</Empty>;
  const preview = rows.slice(0, 5);
  const max = Math.max(...preview.map((r) => r.score), 1);
  return (
    <div className="space-y-2">
      {preview.map((r, i) => {
        const isMe = r.id === meId;
        const medal =
          i === 0 ? "text-amber-400" : i === 1 ? "text-foreground/80" : i === 2 ? "text-amber-700" : "";
        return (
          <div
            key={r.id}
            className={`flex items-center gap-3 rounded-md px-2 py-1.5 text-sm ${
              isMe ? "bg-violet-500/10 ring-1 ring-violet-500/30" : ""
            }`}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted/60 text-xs font-semibold text-foreground/80">
              {i < 3 ? <Trophy className={`h-3.5 w-3.5 ${medal}`} /> : i + 1}
            </div>
            <Link
              to="/agents/$agentId/activity"
              params={{ agentId: r.id }}
                search={{ tab: "activity", range: "week" }}
              className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80"
            >
              <AgentAvatar name={r.name} path={r.avatarPath} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-foreground">
                    {r.name}
                    {isMe && <span className="ml-1 text-[10px] text-violet-300">you</span>}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{r.score} XP</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                    style={{ width: `${(r.score / max) * 100}%` }}
                  />
                </div>
              </div>
            </Link>
          </div>
        );
      })}
    </div>
  );
}

function SalesLeaderboardPreview({
  rows,
  loading,
  error,
  meId,
  period,
}: {
  rows: Array<{ id: string; name: string; avatarPath?: string | null; sold: number; premium: number; taken: number }>;
  loading: boolean;
  error: boolean;
  meId: string;
  period: Period;
}) {
  if (loading) return <Empty>Loading…</Empty>;
  if (error) return <Empty>Leaderboard unavailable</Empty>;
  const ranked = [...rows]
    .filter((r) => r.sold > 0 || r.premium > 0)
    .sort((a, b) => b.sold - a.sold || b.premium - a.premium);
  if (ranked.length === 0) return <Empty>No sales yet in this window</Empty>;
  const preview = ranked.slice(0, 5);
  const max = Math.max(...preview.map((r) => r.sold), 1);
  const fmt = (n: number) =>
    n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return (
    <div className="space-y-2">
      {preview.map((r, i) => {
        const isMe = r.id === meId;
        const medal =
          i === 0 ? "text-amber-400" : i === 1 ? "text-foreground/80" : i === 2 ? "text-amber-700" : "";
        return (
          <div
            key={r.id}
            className={`flex items-center gap-3 rounded-md px-2 py-1.5 text-sm ${
              isMe ? "bg-emerald-500/10 ring-1 ring-emerald-500/30" : ""
            }`}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted/60 text-xs font-semibold text-foreground/80">
              {i < 3 ? <Trophy className={`h-3.5 w-3.5 ${medal}`} /> : i + 1}
            </div>
            <Link
              to="/agents/$agentId/activity"
              params={{ agentId: r.id }}
              search={{ tab: "sales", range: period === "today" ? "day" : period }}
              className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80"
            >
              <AgentAvatar name={r.name} path={r.avatarPath} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-foreground">
                    {r.name}
                    {isMe && <span className="ml-1 text-[10px] text-emerald-300">you</span>}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {r.sold} {r.sold === 1 ? "policy" : "policies"} · {fmt(r.premium)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
                    style={{ width: `${(r.sold / max) * 100}%` }}
                  />
                </div>
              </div>
            </Link>
          </div>
        );
      })}
    </div>
  );
}

function GoalsPreview({
  rows,
  loading,
  period,
}: {
  rows: Array<{ period: GoalPeriod; metric: GoalMetric; target: number; actual: number }>;
  loading: boolean;
  period: Period;
}) {
  if (loading) return <Empty>Loading…</Empty>;
  // Match the dashboard's top-right period toggle.
  const periodMap: Record<Period, GoalPeriod> = {
    today: "weekly",
    week: "weekly",
    month: "monthly",
  };
  const target: GoalPeriod = periodMap[period];
  const metricOrder: GoalMetric[] = ["policies", "items", "premium"];
  const preview = rows
    .filter((r) => r.period === target)
    .sort((a, b) => metricOrder.indexOf(a.metric) - metricOrder.indexOf(b.metric));
  if (preview.length === 0) return <Empty>No goals set yet</Empty>;
  const metricLabel: Record<GoalMetric, string> = {
    policies: "Policies",
    items: "Items",
    premium: "Premium",
  };
  const periodLbl: Record<GoalPeriod, string> = {
    weekly: "Week",
    monthly: "Month",
    quarterly: "Qtr",
    yearly: "Year",
  };
  const fmt = (m: GoalMetric, n: number) =>
    m === "premium"
      ? n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })
      : Math.round(n).toLocaleString();
  return (
    <ul className="space-y-2">
      {preview.map((g) => {
        const pct = g.target > 0 ? Math.min(100, (g.actual / g.target) * 100) : 0;
        const hit = g.actual >= g.target && g.target > 0;
        return (
          <li
            key={`${g.period}-${g.metric}`}
            className="rounded-md border border-border bg-muted/40 px-3 py-2"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground/80">
                <span className="text-muted-foreground">{periodLbl[g.period]} ·</span>{" "}
                {metricLabel[g.metric]}
              </span>
              <span className={`tabular-nums ${hit ? "text-emerald-300" : "text-foreground"}`}>
                {fmt(g.metric, g.actual)} / {fmt(g.metric, g.target)}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${hit ? "bg-emerald-500" : "bg-gradient-to-r from-rose-500 to-amber-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
