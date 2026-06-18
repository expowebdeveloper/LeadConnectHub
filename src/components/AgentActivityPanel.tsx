import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { getActivityDetail, getAgentActivity, getAgentSalesDetails, listSalesAgents } from "@/lib/admin.functions";
import { AgentAvatar } from "@/components/AgentAvatar";
import { useAuth } from "@/lib/auth";
import { dispatchCallInitiated } from "@/components/CallOutcomeDialog";
import {
  Activity,
  PhoneCall,
  Handshake,
  Trophy,
  ClipboardCheck,
  ExternalLink,
  Package,
  DollarSign,
  FileText,
  Layers,
  Zap,
} from "lucide-react";
import { summarizeLeadSales } from "@/lib/sale-summary";
import { quoteCreditKey } from "@/lib/quote-credit";
import {
  formatSpeed,
  SPEED_TIER_EMOJI,
  SPEED_TIER_LABEL,
  type SpeedTier,
} from "@/lib/speed-to-claim";
import {
  formatUnclaimedRate,
  unclaimedRateColor,
} from "@/lib/unclaimed-rate";

type Range = "day" | "week" | "month" | "custom";
export type ActivityFilter = "all" | "calls" | "claims" | "quotes" | "emails" | "dispo";

const FILTER_LABELS: Record<ActivityFilter, string> = {
  all: "All",
  calls: "Calls",
  claims: "Claims",
  quotes: "Quotes",
  emails: "Emails",
  dispo: "Dispo changes",
};

const FILTER_ACTIONS: Record<Exclude<ActivityFilter, "all">, string[]> = {
  calls: ["call_logged", "call_guide_step", "call_guide_voicemail", "call_guide_result"],
  claims: ["claimed", "released", "reassigned", "transferred", "transferred_in"],
  quotes: ["quoted_premium_changed", "line_premium_changed"],
  emails: ["email_sent"],
  dispo: ["dispo_changed"],
};

function toIsoStartOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}
function toIsoEndOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
}
function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function computeRange(range: Range, customFrom: string, customTo: string) {
  const now = new Date();
  if (range === "day") {
    return { from: toIsoStartOfDay(now), to: toIsoEndOfDay(now) };
  }
  if (range === "week") {
    // Calendar week starting Sunday — matches the dashboard Performance
    // leaderboard so per-agent details never drift from the summary tile.
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    return { from: toIsoStartOfDay(start), to: toIsoEndOfDay(now) };
  }
  if (range === "month") {
    // Calendar month (1st → today) — matches the dashboard leaderboard's
    // "this month" window. Last-30-days drifted from the summary numbers.
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: toIsoStartOfDay(start), to: toIsoEndOfDay(now) };
  }
  const from = customFrom ? new Date(customFrom) : new Date(now);
  const to = customTo ? new Date(customTo) : new Date(now);
  return { from: toIsoStartOfDay(from), to: toIsoEndOfDay(to) };
}

const ACTION_LABELS: Record<string, string> = {
  claimed: "Claimed",
  released: "Released",
  reassigned: "Reassigned",
  dispo_changed: "Dispo changed",
  quoted_premium_changed: "Quoted premium",
  line_premium_changed: "Line premium",
  agent_notes_edited: "Notes edited",
  call_logged: "Call logged",
  call_guide_step: "Call step",
  call_guide_voicemail: "Voicemail",
  call_guide_result: "Call result",
  transferred: "Transferred",
  transferred_in: "Transfer received",
  email_sent: "Email sent",
};

const ACTION_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  claimed: "default",
  released: "outline",
  reassigned: "outline",
  dispo_changed: "secondary",
  quoted_premium_changed: "secondary",
  line_premium_changed: "secondary",
  agent_notes_edited: "outline",
  call_logged: "secondary",
  call_guide_step: "outline",
  call_guide_voicemail: "outline",
  call_guide_result: "outline",
  transferred: "default",
  transferred_in: "default",
  email_sent: "secondary",
};

type SaleEventRow = {
  lead_id: string;
  lead_table: "leads" | "list_leads";
  side: "auto" | "home" | "motorcycle" | "boat" | "umbrella" | "flood" | "golf_cart" | "rv";
  items_count: number | null;
  premium: number | null;
  created_at: string;
};

function eventSoldPolicies(events: SaleEventRow[]) {
  return events.length;
}

export function AgentActivityPanel({
  initialAgentId,
  hideAgentPicker = false,
  initialTab = "activity",
  initialRange = "week",
  initialActionFilter = "all",
}: {
  initialAgentId?: string;
  hideAgentPicker?: boolean;
  initialTab?: "activity" | "sales";
  initialRange?: Range;
  initialActionFilter?: ActivityFilter;
} = {}) {
  const fetchAgents = useServerFn(listSalesAgents);
  const fetchActivity = useServerFn(getAgentActivity);
  const fetchSalesDetails = useServerFn(getAgentSalesDetails);
  const { user } = useAuth();
  const viewerId = user?.id ?? null;

  const agentsQ = useQuery({ queryKey: ["activity-agents"], queryFn: () => fetchAgents() });
  const agents = useMemo(
    () => (agentsQ.data ?? []).slice().sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email)),
    [agentsQ.data],
  );

  const [agentId, setAgentId] = useState<string>(initialAgentId ?? "");
  const [tab, setTab] = useState<"activity" | "sales">(initialTab);
  const [range, setRange] = useState<Range>(initialRange);
  const [actionFilter, setActionFilter] = useState<ActivityFilter>(initialActionFilter);
  useEffect(() => { setActionFilter(initialActionFilter); }, [initialActionFilter]);
  const today = ymd(new Date());
  const weekAgo = ymd(new Date(Date.now() - 6 * 86400000));
  const [customFrom, setCustomFrom] = useState(weekAgo);
  const [customTo, setCustomTo] = useState(today);

  useEffect(() => {
    if (initialAgentId) {
      setAgentId(initialAgentId);
      return;
    }
    if (!agentId && agents.length) setAgentId(agents[0].id);
  }, [agents, agentId, initialAgentId]);

  const { from, to } = computeRange(range, customFrom, customTo);

  const activityQ = useQuery({
    queryKey: ["agent-activity", agentId, from, to],
    queryFn: () => fetchActivity({ data: { agent_id: agentId, from, to, limit: 1000 } }),
    enabled: !!agentId,
  });

  const summary = activityQ.data?.summary;
  type ActivityItem = NonNullable<typeof activityQ.data>["activities"][number];
  const allActivities: ActivityItem[] = activityQ.data?.activities ?? [];
  const activities = useMemo<ActivityItem[]>(() => {
    // Collapse "initiated" call_logged rows when a later terminal call_logged
    // (connected / voicemail / no_answer / busy) exists for the same
    // (lead_id, phone) within ±5 minutes — it's the same call, just logged
    // twice (once on click, once when the agent picked an outcome).
    const dropIds = new Set<string>();
    const calls = allActivities.filter((a) => a.action === "call_logged");
    for (const init of calls) {
      const d = (init.details ?? {}) as Record<string, unknown>;
      if (String(d.outcome ?? "") !== "initiated") continue;
      const initT = new Date(init.created_at).getTime();
      const initPhone = String((d.phone as string | undefined) ?? "");
      const terminal = calls.find((c) => {
        if (c.id === init.id) return false;
        const cd = (c.details ?? {}) as Record<string, unknown>;
        const out = String(cd.outcome ?? "");
        if (!out || out === "initiated") return false;
        if (c.lead_id !== init.lead_id) return false;
        const cPhone = String((cd.phone as string | undefined) ?? "");
        if (initPhone && cPhone && initPhone !== cPhone) return false;
        const diff = Math.abs(new Date(c.created_at).getTime() - initT);
        return diff <= 5 * 60 * 1000;
      });
      if (terminal) dropIds.add(init.id);
    }
    const base = dropIds.size
      ? allActivities.filter((a) => !dropIds.has(a.id))
      : allActivities;
    if (actionFilter === "all") return base;
    const allowed = new Set(FILTER_ACTIONS[actionFilter]);
    const filtered = base.filter((a: ActivityItem) => allowed.has(a.action));
    if (actionFilter !== "quotes") return filtered;
    // Only show rows that actually earn quote credit (first-time premium
    // set, empty/0 -> positive). Dedupe by the same key the summary uses,
    // so the visible rows always match the Quotes tile.
    const seen = new Map<string, ActivityItem>();
    for (const a of filtered) {
      const key = quoteCreditKey({
        action: a.action,
        lead_id: a.lead_id,
        lead_table: (a as { lead_table?: string | null }).lead_table ?? null,
        details: (a.details ?? null) as Record<string, unknown> | null,
      });
      if (!key) continue;
      const prev = seen.get(key);
      if (!prev || new Date(a.created_at).getTime() > new Date(prev.created_at).getTime()) {
        seen.set(key, a);
      }
    }
    return Array.from(seen.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [allActivities, actionFilter]);

  const salesQ = useQuery({
    queryKey: ["agent-sales", agentId, from, to],
    queryFn: () => fetchSalesDetails({ data: { agent_id: agentId, from, to, limit: 2000 } }),
    enabled: !!agentId && tab === "sales",
  });

  const salesStats = useMemo(() => {
    const leads = salesQ.data ?? [];
    const summary = summarizeLeadSales(
      leads.map((lead) => ({
        saleEvents: lead._saleEvents,
      })),
    );
    const rows = leads.map((l, index) => {
      const rowSummary = summary.rows[index];
      const policies = eventSoldPolicies(l._saleEvents);
      return {
        lead: l,
        name: `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "(no name)",
        date: l._saleEvents.reduce(
          (latest, event) =>
            new Date(event.created_at).getTime() > new Date(latest).getTime()
              ? event.created_at
              : latest,
          l.created_at,
        ),
        events: l._saleEvents,
        premium: rowSummary.premium,
        items: rowSummary.items,
        policies,
        isBundle: rowSummary.isBundle,
      };
    });
    return { ...summary, rows };
  }, [agentId, salesQ.data]);

  type Metric = "premium" | "items" | "policies" | "leads" | "bundle";
  const [openMetric, setOpenMetric] = useState<Metric | null>(null);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === agentId) ?? null,
    [agents, agentId],
  );

  const grouped = useMemo(() => {
    const m = new Map<string, typeof activities>();
    for (const a of activities) {
      const day = new Date(a.created_at).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      if (!m.has(day)) m.set(day, []);
      m.get(day)!.push(a);
    }
    return Array.from(m.entries());
  }, [activities]);

  return (
    <div className="space-y-4">
      {hideAgentPicker && (
        <Card className="overflow-hidden border-border/60 bg-gradient-to-br from-card via-card to-muted/30">
          <CardContent className="flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4 min-w-0">
              <AgentAvatar
                name={selectedAgent?.full_name || selectedAgent?.email}
                path={selectedAgent?.avatar_url}
                size="xl"
                className="ring-2 ring-border/60 shadow-md shrink-0"
              />
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Agent
                </div>
                <div className="truncate text-2xl font-semibold leading-tight">
                  {selectedAgent
                    ? selectedAgent.full_name || selectedAgent.email
                    : agentsQ.isLoading
                      ? "Loading…"
                      : "Unknown agent"}
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Time range
              </Label>
              <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
                <TabsList>
                  <TabsTrigger value="day">Today</TabsTrigger>
                  <TabsTrigger value="week">This week</TabsTrigger>
                  <TabsTrigger value="month">This month</TabsTrigger>
                  <TabsTrigger value="custom">Custom</TabsTrigger>
                </TabsList>
              </Tabs>
              {range === "custom" && (
                <div className="flex items-end gap-2 pt-2">
                  <div className="space-y-1.5">
                    <Label>From</Label>
                    <Input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>To</Label>
                    <Input type="date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {!hideAgentPicker && (
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-end">
          <div className="flex-1 space-y-1.5">
            <Label>Agent</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="w-full md:w-[320px]">
                <SelectValue placeholder={agentsQ.isLoading ? "Loading…" : "Pick an agent"} />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.full_name || a.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Time range</Label>
            <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
              <TabsList>
                <TabsTrigger value="day">Today</TabsTrigger>
                <TabsTrigger value="week">This week</TabsTrigger>
                <TabsTrigger value="month">This month</TabsTrigger>
                <TabsTrigger value="custom">Custom</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {range === "custom" && (
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label>From</Label>
                <Input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>To</Label>
                <Input type="date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {tab === "sales" ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile
            icon={<DollarSign className="h-4 w-4" />}
            label="Premium"
            value={`$${Math.round(salesStats.premium).toLocaleString()}`}
            onClick={() => setOpenMetric("premium")}
          />
          <StatTile icon={<Package className="h-4 w-4" />} label="Items" value={salesStats.items} onClick={() => setOpenMetric("items")} />
          <StatTile icon={<FileText className="h-4 w-4" />} label="Policies" value={salesStats.policies} onClick={() => setOpenMetric("policies")} />
          <StatTile icon={<Trophy className="h-4 w-4" />} label="Leads sold" value={salesStats.totalLeads} onClick={() => setOpenMetric("leads")} />
          <StatTile
            icon={<Layers className="h-4 w-4" />}
            label="Bundle rate"
            value={`${salesStats.bundleRate.toFixed(0)}%`}
            onClick={() => setOpenMetric("bundle")}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-7">
          <StatTile
            icon={<Activity className="h-4 w-4" />}
            label="Total actions"
            value={summary?.total ?? 0}
            active={actionFilter === "all"}
            onClick={() => { setTab("activity"); setActionFilter("all"); }}
          />
          <StatTile
            icon={<ClipboardCheck className="h-4 w-4" />}
            label="Claims"
            value={summary?.claims ?? 0}
            active={actionFilter === "claims"}
            onClick={() => { setTab("activity"); setActionFilter(actionFilter === "claims" ? "all" : "claims"); }}
          />
          <StatTile
            icon={<PhoneCall className="h-4 w-4" />}
            label="Calls"
            value={summary?.calls ?? 0}
            active={actionFilter === "calls"}
            onClick={() => { setTab("activity"); setActionFilter(actionFilter === "calls" ? "all" : "calls"); }}
          />
          <StatTile
            icon={<Handshake className="h-4 w-4" />}
            label="Quotes"
            value={summary?.quotes ?? 0}
            active={actionFilter === "quotes"}
            onClick={() => { setTab("activity"); setActionFilter(actionFilter === "quotes" ? "all" : "quotes"); }}
          />
          <StatTile icon={<Trophy className="h-4 w-4" />} label="Sold" value={summary?.sold ?? 0} onClick={() => setTab("sales")} />
          <StatTile
            icon={<Zap className="h-4 w-4" />}
            label="Speed to claim"
            value={formatSpeed(summary?.speedToClaim?.avgSec ?? null)}
            sub={
              summary?.speedToClaim && summary.speedToClaim.samples > 0
                ? `Best ${formatSpeed(summary.speedToClaim.bestSec)} · ${summary.speedToClaim.samples} live`
                : "No live claims"
            }
          />
          <StatTile
            icon={<Zap className="h-4 w-4" />}
            label="Unclaimed rate"
            value={
              summary?.unclaimed && summary.unclaimed.eligibleEvents > 0
                ? formatUnclaimedRate(summary.unclaimed.rate)
                : "—"
            }
            sub={
              summary?.unclaimed && summary.unclaimed.eligibleEvents > 0
                ? `${summary.unclaimed.missedEvents}/${summary.unclaimed.eligibleEvents} eligible pops`
                : "No eligible pops"
            }
            valueClassName={
              summary?.unclaimed && summary.unclaimed.eligibleEvents > 0
                ? unclaimedRateColor(summary.unclaimed.rate)
                : undefined
            }
          />
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as "activity" | "sales")}>
        <TabsList className="w-fit">
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "activity" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Filter</span>
          {(Object.keys(FILTER_LABELS) as ActivityFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setActionFilter(f)}
              className={
                "rounded-full border px-2.5 py-0.5 text-xs transition " +
                (actionFilter === f
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/50")
              }
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
          {actionFilter !== "all" && (
            <span className="text-xs text-muted-foreground ml-1">
              Showing {activities.length} of {allActivities.length}
            </span>
          )}
        </div>
      )}

      {tab === "activity" ? (
        <Card>
          <CardContent className="p-0">
            {activityQ.isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading activity…</div>
            ) : activities.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No activity in this range.</div>
            ) : (
              <div className="divide-y">
                {grouped.map(([day, items]) => (
                  <div key={day}>
                    <div className="sticky top-0 z-10 flex items-center justify-between bg-muted/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                      <span>{day}</span>
                      <span>{items.length} action{items.length === 1 ? "" : "s"}</span>
                    </div>
                    <ul className="divide-y">
                      {items.map((a) => (
                        <ActivityRow
                          key={a.id}
                          a={a}
                          agentName={selectedAgent?.full_name || selectedAgent?.email}
                          agentAvatarPath={selectedAgent?.avatar_url}
                          viewerId={viewerId}
                          viewerAgentId={agentId}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {salesQ.isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading sales…</div>
            ) : salesQ.data?.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No sold leads found.</div>
            ) : (
              <div className="divide-y">
                {salesQ.data?.map((s) => (
                  <div key={`${s._table}:${s.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="default" className="bg-emerald-100 text-emerald-900 border-emerald-200">Sold</Badge>
                        <Link
                          to="/leads/$leadId"
                          params={{ leadId: s.id }}
                          search={{ source: s._table === "list_leads" ? "list" : "live" }}
                          className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
                        >
                          {s.first_name ?? ""} {s.last_name ?? ""}
                          <ExternalLink className="h-3 w-3 opacity-60" />
                        </Link>
                        {s.phone && (
                          <span className="text-xs text-muted-foreground tabular-nums">{s.phone}</span>
                        )}
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{s._table}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {s.city && s.state ? `${s.city}, ${s.state}` : s.city || s.state || "—"}
                        {s.current_carrier && ` · ${s.current_carrier}`}
                        {s.quoted_premium !== null && ` · $${s.quoted_premium.toLocaleString()}`}
                        {" · "}
                        {new Date(s.created_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <SalesBreakdownDialog
        open={openMetric !== null}
        metric={openMetric}
        stats={salesStats}
        onOpenChange={(o) => !o && setOpenMetric(null)}
      />
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  onClick,
  active = false,
  sub,
  valueClassName,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  onClick?: () => void;
  active?: boolean;
  sub?: string;
  valueClassName?: string;
}) {
  return (
    <Card
      onClick={onClick}
      className={
        (onClick ? "cursor-pointer transition hover:bg-muted/40 hover:shadow-sm " : "") +
        (active ? "ring-2 ring-primary border-primary/60" : "")
      }
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueClassName ?? ""}`}>{value}</div>
        {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

type SalesRow = {
  lead: { id: string; _table: "leads" | "list_leads" };
  name: string;
  date: string;
  events: SaleEventRow[];
  premium: number;
  items: number;
  policies: number;
  isBundle: boolean;
};

function SalesBreakdownDialog({
  open,
  metric,
  stats,
  onOpenChange,
}: {
  open: boolean;
  metric: "premium" | "items" | "policies" | "leads" | "bundle" | null;
  stats: {
    premium: number;
    items: number;
    policies: number;
    totalLeads: number;
    bundles: number;
    bundleRate: number;
    rows: SalesRow[];
  };
  onOpenChange: (open: boolean) => void;
}) {
  const titles: Record<string, string> = {
    premium: "Premium breakdown",
    items: "Items breakdown",
    policies: "Policies breakdown",
    leads: "Leads sold breakdown",
    bundle: "Bundle rate breakdown",
  };
  const fmt$ = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const sideLabel: Record<string, string> = {
    auto: "Auto",
    home: "Home",
    motorcycle: "Motorcycle",
    boat: "Boat",
    umbrella: "Umbrella",
    flood: "Flood",
    golf_cart: "Golf cart",
    rv: "RV",
  };

  const renderRowDetail = (r: SalesRow) => {
    if (metric === "premium") {
      return (
        <div className="text-xs text-muted-foreground space-y-0.5">
          {r.events.map((e, i) => (
            <div key={i} className="flex justify-between gap-4">
              <span>{sideLabel[e.side] ?? e.side}</span>
              <span className="tabular-nums">{fmt$(Number(e.premium) || 0)}</span>
            </div>
          ))}
          {r.events.length === 0 && (
            <div className="italic">From lead fields (no sale events recorded)</div>
          )}
          <div className="flex justify-between gap-4 pt-1 font-medium text-foreground">
            <span>Subtotal</span>
            <span className="tabular-nums">{fmt$(r.premium)}</span>
          </div>
        </div>
      );
    }
    if (metric === "items") {
      return (
        <div className="text-xs text-muted-foreground space-y-0.5">
          {r.events.map((e, i) => (
            <div key={i} className="flex justify-between gap-4">
              <span>{sideLabel[e.side] ?? e.side}</span>
              <span className="tabular-nums">
                {Math.max(1, Number(e.items_count ?? 1) || 1)} item
                {Math.max(1, Number(e.items_count ?? 1) || 1) === 1 ? "" : "s"}
              </span>
            </div>
          ))}
          {r.events.length === 0 && (
            <div className="italic">From lead fields (no sale events recorded)</div>
          )}
          <div className="flex justify-between gap-4 pt-1 font-medium text-foreground">
            <span>Subtotal</span>
            <span className="tabular-nums">{r.items}</span>
          </div>
        </div>
      );
    }
    if (metric === "policies") {
      return (
        <div className="text-xs text-muted-foreground">
          {r.events.length > 0
            ? r.events.map((e) => sideLabel[e.side] ?? e.side).join(" + ")
            : "From lead fields"}{" "}
          · <span className="font-medium text-foreground">{r.policies} polic{r.policies === 1 ? "y" : "ies"}</span>
        </div>
      );
    }
    if (metric === "bundle") {
      const sides = r.events.map((e) => sideLabel[e.side] ?? e.side).join(" + ");
      return (
        <div className="text-xs text-muted-foreground">
            {r.isBundle ? (
              <span className="font-medium text-emerald-700">Bundle: {sides || "multiple lines"}</span>
          ) : (
            <span>Not a bundle{sides ? ` (${sides})` : ""}</span>
          )}
        </div>
      );
    }
    return (
      <div className="text-xs text-muted-foreground">
        {r.policies} polic{r.policies === 1 ? "y" : "ies"} · {r.items} item{r.items === 1 ? "" : "s"} · {fmt$(r.premium)}
      </div>
    );
  };

  const visibleRows =
    metric === "bundle" ? stats.rows.filter((r) => r.isBundle) : stats.rows;

  const totalLine = () => {
    if (metric === "premium") return `Total: ${fmt$(stats.premium)}`;
    if (metric === "items") return `Total: ${stats.items} items`;
    if (metric === "policies") return `Total: ${stats.policies} policies`;
    if (metric === "leads") return `Total: ${stats.totalLeads} leads sold`;
    if (metric === "bundle")
      return `${stats.bundles} of ${stats.totalLeads} leads bundled · ${stats.bundleRate.toFixed(0)}%`;
    return "";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{metric ? titles[metric] : ""}</DialogTitle>
          <DialogDescription>{totalLine()}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto divide-y rounded-md border">
          {visibleRows.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No matching sales.</div>
          ) : (
            visibleRows.map((r) => (
              <div key={`${r.lead._table}:${r.lead.id}`} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    to="/leads/$leadId"
                    params={{ leadId: r.lead.id }}
                    search={{ source: r.lead._table === "list_leads" ? "list" : "live" }}
                    className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
                  >
                    {r.name}
                    <ExternalLink className="h-3 w-3 opacity-60" />
                  </Link>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {new Date(r.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>
                <div className="mt-1">{renderRowDetail(r)}</div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ActivityRow({
  a,
  agentName,
  agentAvatarPath,
  viewerId,
  viewerAgentId,
}: {
  a: {
    id: string;
    lead_id: string;
    lead_table: string;
    action: string;
    details: unknown;
    created_at: string;
    lead: { name: string; phone: string | null } | null;
  };
  agentName?: string | null;
  agentAvatarPath?: string | null;
  viewerId?: string | null;
  viewerAgentId?: string | null;
}) {
  const d = (a.details ?? {}) as Record<string, unknown>;
  // Show seconds on call_logged rows so back-to-back call attempts within the
  // same minute are visually distinct and don't look like duplicates.
  const time = new Date(a.created_at).toLocaleTimeString(
    [],
    a.action === "call_logged"
      ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
      : { hour: "2-digit", minute: "2-digit" },
  );

  let detailText = "";
  if (a.action === "dispo_changed") {
    detailText = `${d.side ? `[${d.side}] ` : ""}${d.from ?? "—"} → ${d.to ?? "—"}`;
  } else if (a.action === "quoted_premium_changed") {
    detailText = `${d.side ? `[${d.side}] ` : ""}${d.from ?? "—"} → ${d.to ?? "—"}`;
  } else if (a.action === "call_logged") {
    const outcome = String(d.outcome ?? "");
    if (outcome === "initiated") {
      detailText = "Outcome pending";
    } else {
      const dur = d.duration_seconds ? `${d.duration_seconds}s` : "";
      const autoFin = d.auto_finalized ? "auto" : "";
      detailText = [outcome, d.direction, dur, autoFin].filter(Boolean).join(" · ");
    }
  } else if (d.side) {
    detailText = `[${d.side}]`;
  }

  const speedSec = typeof d.speed_seconds === "number" ? d.speed_seconds : null;
  const speedTierVal = (typeof d.speed_tier === "string" ? d.speed_tier : null) as SpeedTier;

  const isPendingCall =
    a.action === "call_logged" && String(d.outcome ?? "") === "initiated";
  const canSetOutcome =
    isPendingCall &&
    !!viewerId &&
    (!viewerAgentId || viewerAgentId === viewerId);
  const callBadgeLabel = isPendingCall ? "Calling…" : ACTION_LABELS[a.action] ?? a.action;
  const callBadgeVariant: "default" | "secondary" | "outline" | "destructive" = isPendingCall
    ? "outline"
    : ACTION_VARIANT[a.action] ?? "outline";

  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <li
      className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 cursor-pointer"
      onClick={() => setDetailOpen(true)}
    >
      <div className="w-20 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{time}</div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={callBadgeVariant}>{callBadgeLabel}</Badge>
          {agentName && (
            <AgentAvatar name={agentName} path={agentAvatarPath} size="sm" className="md:hidden" />
          )}
          <Link
            to="/leads/$leadId"
            params={{ leadId: a.lead_id }}
            search={{ source: a.lead_table === "list_leads" ? "list" : "live" }}
            className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {a.lead?.name ?? "(lead)"}
            <ExternalLink className="h-3 w-3 opacity-60" />
          </Link>
          {a.lead?.phone && (
            <span className="text-xs text-muted-foreground tabular-nums">{a.lead.phone}</span>
          )}
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{a.lead_table}</span>
          {speedSec != null && (
            <span
              className={
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold " +
                (speedTierVal === "lightning"
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  : speedTierVal === "fast"
                    ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                    : speedTierVal === "quick"
                      ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
                      : "border-border bg-muted/50 text-muted-foreground")
              }
              title={speedTierVal ? `${SPEED_TIER_LABEL[speedTierVal]} claim` : "Time to claim"}
            >
              {speedTierVal ? SPEED_TIER_EMOJI[speedTierVal] : "⏱"}
              {formatSpeed(speedSec)}
            </span>
          )}
          {canSetOutcome && viewerId && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const phone =
                  (typeof d.phone === "string" ? d.phone : null) ??
                  a.lead?.phone ??
                  "";
                dispatchCallInitiated({
                  leadId: a.lead_id,
                  leadTable: a.lead_table as "leads" | "list_leads",
                  phone,
                  uid: viewerId,
                  skipScript: true,
                });
              }}
              className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary hover:bg-primary/20"
            >
              Set outcome
            </button>
          )}
        </div>
        {detailText && <div className="mt-0.5 text-xs text-muted-foreground">{detailText}</div>}
      </div>
      <ActivityDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        activityId={a.id}
        leadId={a.lead_id}
        leadTable={a.lead_table}
        action={a.action}
      />
    </li>
  );
}

function ActivityDetailDialog({
  open,
  onOpenChange,
  activityId,
  leadId,
  leadTable,
  action,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  activityId: string;
  leadId: string;
  leadTable: string;
  action: string;
}) {
  const fetchDetail = useServerFn(getActivityDetail);
  const q = useQuery({
    queryKey: ["activity-detail", activityId],
    queryFn: () => fetchDetail({ data: { activity_id: activityId } }),
    enabled: open,
    staleTime: 60_000,
  });

  const title = ACTION_LABELS[action] ?? action;
  const d = q.data;
  const actorName = d?.actor?.full_name || d?.actor?.email || "—";
  const when = d ? new Date(d.created_at).toLocaleString() : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {actorName}
            {when ? ` · ${when}` : ""}
          </DialogDescription>
        </DialogHeader>

        {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {q.error && <div className="text-sm text-destructive">Failed to load details.</div>}

        {d?.kind === "note" && (
          <div className="space-y-2">
            {d.note ? (
              <>
                <div className="flex items-center gap-2">
                  <AgentAvatar
                    name={d.note.author?.full_name || d.note.author?.email || "Note"}
                    path={d.note.author?.avatar_url ?? null}
                    size="sm"
                  />
                  <div className="text-sm font-medium">
                    {d.note.author?.full_name || d.note.author?.email || "Teammate"}
                  </div>
                </div>
                <div className="rounded-md border bg-muted/40 p-3 whitespace-pre-wrap text-sm">
                  {d.note.body}
                </div>
                {d.note.edited_at && (
                  <div className="text-xs text-muted-foreground">
                    Edited {new Date(d.note.edited_at).toLocaleString()}
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Note no longer available.</div>
            )}
          </div>
        )}

        {d?.kind === "call" && (
          <div className="space-y-2 text-sm">
            {d.call ? (
              <>
                <KV k="Outcome" v={d.call.outcome ?? d.call.status ?? "—"} />
                <KV k="Direction" v={d.call.direction} />
                <KV k="From" v={d.call.from_number ?? "—"} />
                <KV k="To" v={d.call.to_number ?? "—"} />
                {d.call.duration_seconds != null && (
                  <KV k="Duration" v={`${d.call.duration_seconds}s`} />
                )}
                {d.call.started_at && (
                  <KV k="Started" v={new Date(d.call.started_at).toLocaleString()} />
                )}
                {d.call.ended_at && (
                  <KV k="Ended" v={new Date(d.call.ended_at).toLocaleString()} />
                )}
                {d.call.hangup_cause && <KV k="Hangup" v={d.call.hangup_cause} />}
                {d.call.recording_url && (
                  <div className="pt-2">
                    <audio controls src={d.call.recording_url} className="w-full" />
                  </div>
                )}
                {d.call.notes && (
                  <div className="rounded-md border bg-muted/40 p-3 whitespace-pre-wrap">
                    {d.call.notes}
                  </div>
                )}
              </>
            ) : (
              <>
                <KV k="Outcome" v={String(d.details.outcome ?? "—")} />
                {d.details.phone != null && <KV k="Phone" v={String(d.details.phone)} />}
                {d.details.direction != null && <KV k="Direction" v={String(d.details.direction)} />}
                {d.details.duration_seconds != null && (
                  <KV k="Duration" v={`${d.details.duration_seconds}s`} />
                )}
              </>
            )}
          </div>
        )}

        {d?.kind === "email" && (
          <div className="space-y-2 text-sm">
            {d.details.template_label != null && (
              <KV k="Template" v={String(d.details.template_label)} />
            )}
            {d.details.recipient != null && (
              <KV k="To" v={String(d.details.recipient)} />
            )}
            {d.details.template_id != null && (
              <KV k="Template ID" v={String(d.details.template_id)} />
            )}
          </div>
        )}

        {d?.kind === "generic" && (
          <div className="space-y-1 text-sm">
            {Object.keys(d.details).length === 0 ? (
              <div className="text-muted-foreground">No additional details.</div>
            ) : (
              Object.entries(d.details).map(([k, v]) => (
                <KV key={k} k={k} v={v == null ? "—" : String(v)} />
              ))
            )}
          </div>
        )}

        <div className="pt-2">
          <Link
            to="/leads/$leadId"
            params={{ leadId }}
            search={{ source: leadTable === "list_leads" ? "list" : "live" }}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            onClick={() => onOpenChange(false)}
          >
            Open lead
            <ExternalLink className="h-3 w-3 opacity-60" />
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium text-right break-all">{v}</span>
    </div>
  );
}