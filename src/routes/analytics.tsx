import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { AppShell, PageHeader, HeroTitle } from "@/components/AppShell";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { getAnalytics } from "@/lib/analytics.functions";
import { GoalsProgress } from "@/components/GoalsProgress";
import { Slider } from "@/components/ui/slider";
import type { GoalPeriod } from "@/lib/goals.functions";
import { EmptyCTA } from "@/components/EmptyCTA";
import { CommissionsPanel } from "@/components/CommissionsPanel";
import { VendorPaymentsPanel } from "@/components/VendorPaymentsPanel";
import { VendorLeadsBreakdown } from "@/components/VendorLeadsBreakdown";
import { useHasRole } from "@/lib/auth";
import { BillingPanel } from "@/routes/billing";
import { AgentActivityPanel } from "@/components/AgentActivityPanel";
import type { ActivityFilter } from "@/components/AgentActivityPanel";
import { formatSpeed, type SpeedToClaimSummary } from "@/lib/speed-to-claim";
import {
  formatUnclaimedRate,
  unclaimedRateColor,
  type UnclaimedSummary,
} from "@/lib/unclaimed-rate";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  TrendingUp,
  Users,
  DollarSign,
  Target,
  Trophy,
  Activity,
  Zap,
  PhoneCall,
  BarChart3,
  Package,
} from "lucide-react";


export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Performance — LeadVault" },
      { name: "description", content: "Lead and sales performance analytics." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    tab: typeof s.tab === "string" ? (s.tab as string) : undefined,
  }),
  component: AnalyticsPage,
});

const PALETTE = ["#6366f1", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#a855f7"];

function formatMoney(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function AnalyticsPage() {
  const { user, loading, isSubAgent } = useAuth();
  const isAdmin = useHasRole("admin");
  const isVendor = useHasRole("vendor");
  const showVendorPayments = isVendor && !isSubAgent;
  const navigate = useNavigate();
  const [window, setWindow] = useState<"day" | "week" | "month">("week");
  const search = Route.useSearch();
  const initialTab = (search.tab === "commissions" || search.tab === "activity")
    ? search.tab
    : "overview";
  const [mainTab, setMainTab] = useState<"overview" | "commissions" | "activity">(initialTab);
  // Admin-only: which audience to view (sales agents vs vendors w/ billing).
  const [adminAudience, setAdminAudience] = useState<"sales" | "vendors">("sales");
  // Sales: "self" (default) vs "team" benchmark view
  const [salesView, setSalesView] = useState<"self" | "team">("self");
  // Admin: pick an individual agent (empty string = team-wide)
  const [adminAgentId, setAdminAgentId] = useState<string>("");
  // Goals time-view (slider): weekly/monthly/quarterly/yearly
  const PERIODS: GoalPeriod[] = ["weekly", "monthly", "quarterly", "yearly"];
  const PERIOD_LABELS: Record<GoalPeriod, string> = {
    weekly: "Weekly",
    monthly: "Monthly",
    quarterly: "Quarterly",
    yearly: "Yearly",
  };
  const [goalPeriodIdx, setGoalPeriodIdx] = useState<number>(0);
  const goalPeriod = PERIODS[goalPeriodIdx];

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  const fetchAnalytics = useServerFn(getAnalytics);
  const asUserId = user?.id ?? null;
  const tz =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      : "UTC";
  const { data, isLoading, error } = useQuery({
    queryKey: ["analytics", salesView, adminAgentId, asUserId, tz],
    queryFn: () =>
      fetchAnalytics({
        data: {
          view: salesView,
          agentId: adminAgentId || null,
          asUserId,
          tz,
        },
      }),
    enabled: !!user,
    retry: false,
  });

  if (loading || !user) return null;

  if (error) {
    return (
      <AppShell>
        <PageHeader title={<HeroTitle label="Performance" icon={BarChart3} />} />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Analytics aren't available for your account. Ask your vendor admin
            if you need access.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const trendData = !data
    ? []
    : window === "week"
      ? data.trendWeek
      : window === "month"
        ? data.trendMonth
        : data.trend;
  const trendTitle =
    window === "week" ? "Last 8 weeks" : window === "month" ? "Last 6 months" : "Last 14 days";
  const winKey = window === "day" ? "today" : window;
  const vendorsForWindow = data?.vendorsByWindow?.[winKey] ?? data?.leadsByVendor ?? [];
  const dispoForWindow = data?.dispoByWindow?.[winKey] ?? data?.dispoBreakdown ?? [];
  const windowLabel = window === "day" ? "today" : window === "week" ? "this week" : "this month";

  const myAct =
    data?.myActivity?.[window === "day" ? "today" : window] ?? null;
  const activityForWindow =
    data?.activityByWindow?.[window === "day" ? "today" : window] ?? [];

  return (
    <AppShell>
      <PageHeader
        title={<HeroTitle label="Performance" icon={BarChart3} />}
      />

      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as "overview" | "commissions" | "activity")} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {(!isVendor || showVendorPayments) && (
            <TabsTrigger value="commissions">
              {isVendor ? "Payments" : "Commissions"}
            </TabsTrigger>
          )}
          {isAdmin && <TabsTrigger value="activity">Agent Activity</TabsTrigger>}
          {!isAdmin && !isVendor && (
            <TabsTrigger value="activity">My Sales Breakdown</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {isAdmin && (
            <Tabs
              value={adminAudience}
              onValueChange={(v) => setAdminAudience(v as "sales" | "vendors")}
            >
              <TabsList>
                <TabsTrigger value="sales">Sales Agents</TabsTrigger>
                <TabsTrigger value="vendors">Vendors</TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {isAdmin && adminAudience === "vendors" ? (
            <BillingPanel />
          ) : isLoading || !data ? (
            <div className="grid gap-4 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}><CardContent className="h-28" /></Card>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {data.scope === "sales" && !isVendor && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-card/50 p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="text-sm font-medium text-foreground">
                        Goals view:{" "}
                        <span className="text-primary">{PERIOD_LABELS[goalPeriod]}</span>
                      </div>
                      <div className="hidden sm:flex gap-4 text-[11px] uppercase tracking-wider text-muted-foreground">
                        {PERIODS.map((p, i) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setGoalPeriodIdx(i)}
                            className={
                              i === goalPeriodIdx
                                ? "text-primary font-semibold"
                                : "hover:text-foreground transition"
                            }
                          >
                            {PERIOD_LABELS[p]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Slider
                      value={[goalPeriodIdx]}
                      onValueChange={(v) => setGoalPeriodIdx(v[0] ?? 0)}
                      min={0}
                      max={PERIODS.length - 1}
                      step={1}
                    />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <GoalsProgress
                      scope="agent"
                      agentId={data.currentUserId}
                      title="My Goals"
                      description={`${PERIOD_LABELS[goalPeriod]} progress.`}
                      period={goalPeriod}
                    />
                    <GoalsProgress
                      scope="agency"
                      title="Agency Goals"
                      description={`Whole-agency ${PERIOD_LABELS[goalPeriod].toLowerCase()} progress.`}
                      period={goalPeriod}
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                {data.scope !== "vendor" && (
                  <Tabs value={window} onValueChange={(v) => setWindow(v as "day" | "week" | "month")}>
                    <TabsList>
                      <TabsTrigger value="day">Today</TabsTrigger>
                      <TabsTrigger value="week">This Week</TabsTrigger>
                      <TabsTrigger value="month">This Month</TabsTrigger>
                    </TabsList>
                  </Tabs>
                )}

                {data.scope === "sales" && (
                  <Tabs
                    value={salesView}
                    onValueChange={(v) => setSalesView(v as "self" | "team")}
                  >
                    <TabsList>
                      <TabsTrigger value="self">My Performance</TabsTrigger>
                      <TabsTrigger value="team">Team</TabsTrigger>
                    </TabsList>
                  </Tabs>
                )}

                {data.scope === "admin" && (
                  <Select
                    value={adminAgentId || "__all"}
                    onValueChange={(v) => setAdminAgentId(v === "__all" ? "" : v)}
                  >
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="View team or agent" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all">Entire team</SelectItem>
                      {(data.agents ?? []).map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                          {a.id === data.currentUserId ? " (me)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* KPI Cards */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {data.scope === "vendor" ? (
                  <>
                    <KpiCard
                      label="Leads This Week"
                      value={data.kpis.leadsWeek.toString()}
                      sub={`${data.kpis.leadsToday} today · ${data.kpis.leadsMonth} this month`}
                      icon={<Activity className="h-5 w-5" />}
                      gradient="from-indigo-500 to-violet-500"
                      detail={{
                        description: "Leads delivered to you, broken down by window.",
                        rows: [
                          { label: "Today", value: data.kpis.leadsToday.toString() },
                          { label: "This week", value: data.kpis.leadsWeek.toString() },
                          { label: "This month", value: data.kpis.leadsMonth.toString() },
                        ],
                        linkTo: "/my-leads",
                        linkLabel: "Open My Leads",
                      }}
                    />
                    <KpiCard
                      label="Amount Earned This Week"
                      value={formatMoney(data.vendorRevenue.week)}
                      sub={`${formatMoney(data.vendorRevenue.today)} today · ${formatMoney(data.vendorRevenue.month)} this month`}
                      icon={<DollarSign className="h-5 w-5" />}
                      gradient="from-emerald-500 to-teal-500"
                      detail={{
                        description: "Estimated payout based on billable leads delivered.",
                        rows: [
                          { label: "Today", value: formatMoney(data.vendorRevenue.today) },
                          { label: "This week", value: formatMoney(data.vendorRevenue.week) },
                          { label: "This month", value: formatMoney(data.vendorRevenue.month) },
                        ],
                        linkTo: "/analytics",
                        linkLabel: "View vendor breakdown",
                      }}
                    />
                  </>
                ) : (
                  <>
                <KpiCard
                  label={`Leads ${windowLabel}`}
                  value={(window === "day" ? data.kpis.leadsToday : window === "week" ? data.kpis.leadsWeek : data.kpis.leadsMonth).toString()}
                  sub={`${data.kpis.leadsWeek} this week · ${data.kpis.leadsMonth} this month`}
                  icon={<Activity className="h-5 w-5" />}
                  gradient="from-indigo-500 to-violet-500"
                  detail={{
                    description: "New leads claimed/owned in each window.",
                    rows: [
                      { label: "Today", value: data.kpis.leadsToday.toString() },
                      { label: "This week", value: data.kpis.leadsWeek.toString() },
                      { label: "This month", value: data.kpis.leadsMonth.toString() },
                    ],
                    linkTo: "/my-leads",
                    linkLabel: "Open My Leads",
                  }}
                  breakdown={data.breakdowns?.leads?.[winKey]}
                />
                <KpiCard
                  label={`Policies sold ${windowLabel}`}
                  value={(data.kpisByWindow?.[winKey]?.sold ?? 0).toString()}
                  sub={`${data.kpis.totalSold} in last 60d · auto + home counted separately`}
                  icon={<Target className="h-5 w-5" />}
                  gradient="from-emerald-500 to-teal-500"
                  detail={{
                    description: "Auto and home policies are counted separately.",
                    rows: [
                      { label: "Today", value: (data.kpisByWindow?.today?.sold ?? 0).toString() },
                      { label: "This week", value: (data.kpisByWindow?.week?.sold ?? 0).toString() },
                      { label: "This month", value: (data.kpisByWindow?.month?.sold ?? 0).toString() },
                      { label: "Last 60 days", value: data.kpis.totalSold.toString() },
                    ],
                    linkTo: "/commissions",
                    linkLabel: "View commissions",
                  }}
                  breakdown={data.breakdowns?.policies?.[winKey]}
                />
                <KpiCard
                  label={`Items sold ${windowLabel}`}
                  value={(data.kpisByWindow?.[winKey]?.items ?? 0).toString()}
                  sub={`${data.kpis.totalItems ?? 0} in last 60d · vehicles, dwellings, lines`}
                  icon={<Package className="h-5 w-5" />}
                  gradient="from-cyan-500 to-sky-500"
                  detail={{
                    description:
                      "Total item count across every sold side (e.g. 3 vehicles on one auto sale = 3 items).",
                    rows: [
                      { label: "Today", value: (data.kpisByWindow?.today?.items ?? 0).toString() },
                      { label: "This week", value: (data.kpisByWindow?.week?.items ?? 0).toString() },
                      { label: "This month", value: (data.kpisByWindow?.month?.items ?? 0).toString() },
                      { label: "Last 60 days", value: (data.kpis.totalItems ?? 0).toString() },
                    ],
                    linkTo: "/commissions",
                    linkLabel: "View commissions",
                  }}
                  breakdown={data.breakdowns?.items?.[winKey]}
                />
                <KpiCard
                  label={`Premium Sold ${windowLabel}`}
                  value={formatMoney(data.kpisByWindow?.[winKey]?.premium ?? 0)}
                  sub={`${formatMoney(data.kpis.premiumSold)} last 60d`}
                  icon={<DollarSign className="h-5 w-5" />}
                  gradient="from-amber-500 to-orange-500"
                  detail={{
                    description: "Total written premium for policies sold in each window.",
                    rows: [
                      { label: "Today", value: formatMoney(data.kpisByWindow?.today?.premium ?? 0) },
                      { label: "This week", value: formatMoney(data.kpisByWindow?.week?.premium ?? 0) },
                      { label: "This month", value: formatMoney(data.kpisByWindow?.month?.premium ?? 0) },
                      { label: "Last 60 days", value: formatMoney(data.kpis.premiumSold) },
                    ],
                    linkTo: "/commissions",
                    linkLabel: "View commissions",
                  }}
                  breakdown={data.breakdowns?.premium?.[winKey]}
                />
                <KpiCard
                  label={`Close Rate ${windowLabel}`}
                  value={`${(data.kpisByWindow?.[winKey]?.closeRate ?? 0).toFixed(1)}%`}
                  sub="sold / quoted"
                  icon={<TrendingUp className="h-5 w-5" />}
                  gradient="from-pink-500 to-rose-500"
                  detail={{
                    description: "Sold policies divided by quoted policies in each window.",
                    rows: [
                      { label: "Today", value: `${(data.kpisByWindow?.today?.closeRate ?? 0).toFixed(1)}%` },
                      { label: "This week", value: `${(data.kpisByWindow?.week?.closeRate ?? 0).toFixed(1)}%` },
                      { label: "This month", value: `${(data.kpisByWindow?.month?.closeRate ?? 0).toFixed(1)}%` },
                    ],
                  }}
                  breakdown={data.breakdowns?.closeRate?.[winKey]}
                />
                {isAdmin && (
                  <KpiCard
                    label={`Lead Cost ${windowLabel}`}
                    value={formatMoney(window === "day" ? data.vendorRevenue.today : window === "week" ? data.vendorRevenue.week : data.vendorRevenue.month)}
                    sub={`${formatMoney(data.vendorRevenue.week)} this week · ${formatMoney(data.vendorRevenue.month)} this month`}
                    icon={<DollarSign className="h-5 w-5" />}
                    gradient="from-rose-500 to-red-500"
                    detail={{
                      description: "Total billable lead cost owed to vendors.",
                      rows: [
                        { label: "Today", value: formatMoney(data.vendorRevenue.today) },
                        { label: "This week", value: formatMoney(data.vendorRevenue.week) },
                        { label: "This month", value: formatMoney(data.vendorRevenue.month) },
                      ],
                      linkTo: "/billing",
                      linkLabel: "Open billing",
                    }}
                    breakdown={data.breakdowns?.leadCost?.[winKey]}
                  />
                )}
                <KpiCard
                  label={`Activity Score ${windowLabel}`}
                  value={(myAct?.score ?? 0).toString()}
                  sub={
                    myAct
                      ? `${myAct.calls} calls (${myAct.connectedCalls} connected) · ${myAct.dispoChanges} dispo · ${myAct.quotes} quotes${
                          myAct.speedToClaim && myAct.speedToClaim.samples > 0
                            ? ` · ⚡ ${formatSpeed(myAct.speedToClaim.avgSec)} avg`
                            : ""
                        }`
                      : "No activity yet"
                  }
                  icon={<Zap className="h-5 w-5" />}
                  gradient="from-fuchsia-500 to-purple-500"
                  detail={{
                    description: "Weighted score from calls, dispo updates, quotes, claims, and notes. Connected calls earn a bonus. Fast claims on live leads stack +1/+3/+5 speed bonus points.",
                    rows: myAct
                      ? [
                          { label: "Calls", value: myAct.calls.toString() },
                          { label: "Connected calls", value: myAct.connectedCalls.toString() },
                          { label: "Dispo changes", value: myAct.dispoChanges.toString() },
                          { label: "Quotes", value: myAct.quotes.toString() },
                          ...(myAct.speedToClaim && myAct.speedToClaim.samples > 0
                            ? [
                                {
                                  label: "Avg time to claim",
                                  value: `${formatSpeed(myAct.speedToClaim.avgSec)} (best ${formatSpeed(myAct.speedToClaim.bestSec)})`,
                                },
                                {
                                  label: "Speed bonus pts",
                                  value: `+${myAct.speedToClaim.bonus}`,
                                },
                              ]
                            : []),
                          { label: "Score", value: myAct.score.toString() },
                        ]
                      : [],
                  }}
                  breakdown={data.breakdowns?.activity?.[winKey]}
                />
                  </>
                )}
              </div>

              {/* Activity leaderboard — moved up under KPI cards */}
              {(data.scope === "admin" || data.scope === "sales") && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-fuchsia-500" />
                      Activity Leaderboard ({windowLabel})
                    </CardTitle>
                    <CardDescription>
                      Weighted score from calls, dispo updates, quotes, claims & notes.
                      Connected calls earn a bonus.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ActivityList rows={activityForWindow} isAdmin={isAdmin} />
                  </CardContent>
                </Card>
              )}

              {data.scope === "vendor" && <VendorLeadsBreakdown />}

              <div className="grid gap-6 lg:grid-cols-2">
                {/* Leads by vendor (admin only) */}
                {data.scope === "admin" && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-indigo-500" />
                        Leads by Vendor ({windowLabel})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="h-72">
                      {vendorsForWindow.length === 0 ? (
                        <EmptyState />
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={vendorsForWindow} layout="vertical" margin={{ left: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                            <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                            <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={120} />
                            <Tooltip />
                            <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                              {vendorsForWindow.map((_: unknown, i: number) => (
                                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Dispo breakdown */}
                {data.scope !== "vendor" && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Disposition mix ({windowLabel})</CardTitle>
                    </CardHeader>
                    <CardContent className="h-72">
                      {dispoForWindow.length === 0 ? (
                        <EmptyState />
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={dispoForWindow}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={55}
                              outerRadius={90}
                              paddingAngle={3}
                            >
                              {dispoForWindow.map((_: unknown, i: number) => (
                                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                              ))}
                            </Pie>
                            <Tooltip />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Top agents (admin only) */}
              {data.scope === "admin" && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Trophy className="h-4 w-4 text-amber-500" />
                      Top Agents
                    </CardTitle>
                    <CardDescription>Most leads taken by window</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Tabs defaultValue="day">
                      <TabsList>
                        <TabsTrigger value="day">Today</TabsTrigger>
                        <TabsTrigger value="week">Week</TabsTrigger>
                        <TabsTrigger value="month">Month</TabsTrigger>
                      </TabsList>
                      <TabsContent value="day"><AgentList agents={data.topAgentsDay} /></TabsContent>
                      <TabsContent value="week"><AgentList agents={data.topAgentsWeek} /></TabsContent>
                      <TabsContent value="month"><AgentList agents={data.topAgentsMonth} /></TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              )}

              {/* Activity leaderboard moved above */}
            </div>
          )}
        </TabsContent>

        <TabsContent value="commissions">
          {isVendor ? (
            showVendorPayments ? <VendorPaymentsPanel /> : null
          ) : (
            <CommissionsPanel />
          )}
        </TabsContent>

        {isAdmin ? (
          <TabsContent value="activity">
            <AgentActivityPanel />
          </TabsContent>
        ) : !isVendor ? (
          <TabsContent value="activity">
            <AgentActivityPanel
              initialAgentId={user.id}
              hideAgentPicker
              initialTab="sales"
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </AppShell>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon,
  gradient,
  detail,
  breakdown,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  gradient: string;
  detail?: {
    description?: string;
    rows?: { label: string; value: string }[];
    linkTo?: string;
    linkLabel?: string;
  };
  breakdown?: {
    formula: string;
    rows: { id: string; primary: string; secondary?: string; value: string; when?: string | null }[];
    total: string;
    truncated?: number;
  };
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const clickable = !!detail || !!breakdown;
  return (
    <>
    <Card
      className={`relative overflow-hidden ${clickable ? "cursor-pointer transition-transform hover:-translate-y-0.5 hover:shadow-md" : ""}`}
      onClick={clickable ? () => setOpen(true) : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpen(true);
              }
            }
          : undefined
      }
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-10`} />
      <CardContent className="relative p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <div className={`rounded-lg bg-gradient-to-br ${gradient} p-2 text-white shadow-sm`}>
            {icon}
          </div>
        </div>
        <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
    {clickable && (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className={`rounded-md bg-gradient-to-br ${gradient} p-1.5 text-white`}>{icon}</span>
              {label}
            </DialogTitle>
            {detail?.description && (
              <DialogDescription>{detail.description}</DialogDescription>
            )}
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Current</div>
              <div className="mt-1 text-3xl font-semibold tracking-tight">{value}</div>
              {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
            </div>
            {detail?.rows && detail.rows.length > 0 && (
              <div className="divide-y rounded-lg border">
                {detail.rows.map((r) => (
                  <div key={r.label} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-muted-foreground">{r.label}</span>
                    <span className="text-sm font-semibold tabular-nums">{r.value}</span>
                  </div>
                ))}
              </div>
            )}
            {breakdown && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Show your work
                  </div>
                  <div className="text-xs tabular-nums font-semibold">
                    Total: {breakdown.total}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">{breakdown.formula}</div>
                {breakdown.rows.length === 0 ? (
                  <div className="rounded-lg border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
                    No contributing records in this window.
                  </div>
                ) : (
                  <div className="max-h-72 overflow-y-auto rounded-lg border">
                    <div className="divide-y">
                      {breakdown.rows.map((r) => (
                        <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium capitalize">{r.primary}</div>
                            <div className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                              {r.secondary && <span className="truncate">{r.secondary}</span>}
                              {r.when && <span>{r.when}</span>}
                            </div>
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">{r.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {breakdown.truncated ? (
                  <div className="text-[11px] text-muted-foreground">
                    +{breakdown.truncated} more rows not shown.
                  </div>
                ) : null}
              </div>
            )}
            {detail?.linkTo && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate({ to: detail.linkTo! });
                }}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                {detail.linkLabel ?? "View details"}
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    )}
    </>
  );
}

function AgentList({
  agents,
}: {
  agents: { id: string; name: string; taken: number; sold: number; premium: number }[];
}) {
  if (agents.length === 0) return <EmptyState />;
  const max = Math.max(...agents.map((a) => a.taken), 1);
  return (
    <div className="mt-4 space-y-3">
      {agents.map((a, i) => (
        <div key={a.id} className="rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ background: PALETTE[i % PALETTE.length] }}
              >
                {i + 1}
              </div>
              <div>
                <div className="text-sm font-medium">{a.name}</div>
                <div className="text-xs text-muted-foreground">
                  {a.sold} sold · {formatMoney(a.premium)} premium
                </div>
              </div>
            </div>
            <Badge variant="secondary">{a.taken} taken</Badge>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(a.taken / max) * 100}%`,
                background: PALETTE[i % PALETTE.length],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  title = "No data yet",
  description = "Once you start working leads, your numbers will show up here.",
  primaryTo = "/call-queue",
  primaryLabel = "Browse Live Leads",
  secondaryTo = "/my-leads",
  secondaryLabel = "Open My Board",
}: {
  title?: string;
  description?: string;
  primaryTo?: string;
  primaryLabel?: string;
  secondaryTo?: string;
  secondaryLabel?: string;
}) {
  return (
    <EmptyCTA
      icon={Activity}
      title={title}
      description={description}
      actions={[
        { label: primaryLabel, to: primaryTo },
        { label: secondaryLabel, to: secondaryTo, variant: "outline" },
      ]}
      size="sm"
    />
  );
}

type ActivityRowVM = {
  id: string;
  name: string;
  avatarPath?: string | null;
  score: number;
  actions: number;
  calls: number;
  connectedCalls: number;
  dispoChanges: number;
  quotes: number;
  claims: number;
  notes: number;
  emails: number;
  speedToClaim?: SpeedToClaimSummary;
  unclaimed?: UnclaimedSummary;
};

function ActivityList({ rows, isAdmin = false }: { rows: ActivityRowVM[]; isAdmin?: boolean }) {
  if (rows.length === 0) return <EmptyState />;
  const max = Math.max(...rows.map((r) => r.score), 1);
  const [openAgentId, setOpenAgentId] = useState<string | null>(null);
  const [openAgentName, setOpenAgentName] = useState<string>("");
  const [openFilter, setOpenFilter] = useState<ActivityFilter>("all");
  const openDrill = (id: string, name: string, filter: ActivityFilter = "all") => {
    setOpenAgentId(id);
    setOpenAgentName(name);
    setOpenFilter(filter);
  };
  const stopAnd = (fn: () => void) => (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if ("key" in e && e.key !== "Enter" && e.key !== " ") return;
    if ("key" in e) e.preventDefault();
    fn();
  };
  return (
    <div className="mt-2 space-y-3">
      {rows.map((r, i) => (
        <div
          key={r.id}
          className="rounded-lg border bg-card p-3 cursor-pointer transition-colors hover:bg-muted/40"
          role="button"
          tabIndex={0}
          onClick={() => openDrill(r.id, r.name, "all")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openDrill(r.id, r.name, "all");
            }
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ background: PALETTE[i % PALETTE.length] }}
              >
                {i + 1}
              </div>
              <AgentAvatar name={r.name} path={r.avatarPath} size="lg" />
              <div>
                <div className="text-sm font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={stopAnd(() => openDrill(r.id, r.name, "calls"))}
                    className="inline-flex items-center gap-1 rounded px-1 -mx-1 hover:bg-muted hover:text-foreground transition"
                  >
                    <PhoneCall className="h-3 w-3" />
                    {r.calls} calls ({r.connectedCalls} connected)
                  </button>
                  <span>·</span>
                  <button type="button" onClick={stopAnd(() => openDrill(r.id, r.name, "dispo"))} className="rounded px-1 -mx-1 hover:bg-muted hover:text-foreground transition">{r.dispoChanges} dispo</button>
                  <span>·</span>
                  <button type="button" onClick={stopAnd(() => openDrill(r.id, r.name, "quotes"))} className="rounded px-1 -mx-1 hover:bg-muted hover:text-foreground transition">{r.quotes} quotes</button>
                  <span>·</span>
                  <button type="button" onClick={stopAnd(() => openDrill(r.id, r.name, "claims"))} className="rounded px-1 -mx-1 hover:bg-muted hover:text-foreground transition">{r.claims} claims</button>
                  <span>·</span>
                  <button type="button" onClick={stopAnd(() => openDrill(r.id, r.name, "emails"))} className="rounded px-1 -mx-1 hover:bg-muted hover:text-foreground transition">{r.emails} emails</button>
                  {r.speedToClaim && r.speedToClaim.samples > 0 && (
                    <>
                      <span>·</span>
                      <span
                        className="inline-flex items-center gap-1 text-amber-300"
                        title={`Avg ${formatSpeed(r.speedToClaim.avgSec)} · Best ${formatSpeed(r.speedToClaim.bestSec)} · +${r.speedToClaim.bonus} bonus pts`}
                      >
                        <Zap className="h-3 w-3" />
                        {formatSpeed(r.speedToClaim.avgSec)} avg
                      </span>
                    </>
                  )}
                  {r.unclaimed && r.unclaimed.eligibleEvents > 0 && (
                    <>
                      <span>·</span>
                      <span
                        className={`inline-flex items-center gap-1 ${unclaimedRateColor(r.unclaimed.rate)}`}
                        title={`${r.unclaimed.missedEvents} of ${r.unclaimed.eligibleEvents} eligible pops went unclaimed within 10 min (on-call agents exempted)`}
                      >
                        {formatUnclaimedRate(r.unclaimed.rate)} unclaimed
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <Badge variant="secondary" className="font-mono">{r.score} pts</Badge>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(r.score / max) * 100}%`,
                background: PALETTE[i % PALETTE.length],
              }}
            />
          </div>
        </div>
      ))}
      <Dialog open={!!openAgentId} onOpenChange={(o) => { if (!o) setOpenAgentId(null); }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{openAgentName} — Activity detail</DialogTitle>
          </DialogHeader>
          {openAgentId && (
            <AgentActivityPanel
              initialAgentId={openAgentId}
              hideAgentPicker
              initialActionFilter={openFilter}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}