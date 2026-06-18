import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Range =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "last_month"
  | "ytd"
  | "last_7d"
  | "last_30d"
  | "last_60d"
  | "last_90d"
  | "all_time"
  | { from: string; to: string };

export function resolveRange(range: Range): { from: string; to: string; label: string } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (typeof range === "object") {
    return { from: range.from, to: range.to, label: `${range.from} → ${range.to}` };
  }
  let from: Date;
  let to: Date = new Date();
  switch (range) {
    case "today":
      from = startOfDay(now); break;
    case "yesterday": {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      from = startOfDay(y); to = startOfDay(now); break;
    }
    case "week": {
      const d = new Date(now); const day = d.getDay() || 7; d.setDate(d.getDate() - (day - 1));
      from = startOfDay(d); break;
    }
    case "month":
      from = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case "last_month": {
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    }
    case "ytd":
      from = new Date(now.getFullYear(), 0, 1); break;
    case "last_7d":
      from = new Date(now.getTime() - 7 * 86400000); break;
    case "last_30d":
      from = new Date(now.getTime() - 30 * 86400000); break;
    case "last_60d":
      from = new Date(now.getTime() - 60 * 86400000); break;
    case "last_90d":
      from = new Date(now.getTime() - 90 * 86400000); break;
    case "all_time":
      // Cap at 2 years to keep queries bounded.
      from = new Date(now.getTime() - 730 * 86400000); break;
    default:
      from = startOfDay(now);
  }
  return { from: from.toISOString(), to: to.toISOString(), label: `${range}` };
}

function businessDaysBetween(from: Date, to: Date): number {
  let n = 0;
  const d = new Date(from);
  while (d <= to) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

export async function kpiSnapshot(range: Range) {
  const { from, to, label } = resolveRange(range);
  const sb = supabaseAdmin;
  const [leadsRes, claimedRes, soldRes, callsRes] = await Promise.all([
    sb.from("leads").select("id", { count: "exact", head: true }).gte("created_at", from).lt("created_at", to),
    sb.from("leads").select("id", { count: "exact", head: true }).gte("claimed_at", from).lt("claimed_at", to),
    sb.from("sale_events").select("id, premium_amount", { count: "exact" }).gte("created_at", from).lt("created_at", to),
    sb.from("call_logs").select("id", { count: "exact", head: true }).gte("created_at", from).lt("created_at", to),
  ]);
  const sales = soldRes.data ?? [];
  const premium = sales.reduce((s, r: any) => s + Number(r.premium_amount ?? 0), 0);
  const claimed = claimedRes.count ?? 0;
  const sold = soldRes.count ?? 0;
  return {
    range: label,
    from, to,
    leads_new: leadsRes.count ?? 0,
    leads_claimed: claimed,
    calls: callsRes.count ?? 0,
    sales: sold,
    premium,
    close_rate: claimed > 0 ? +(sold / claimed).toFixed(4) : 0,
    as_of: new Date().toISOString(),
  };
}

export async function agentPerformance(opts: { agent_id?: string; range: Range }) {
  const { from, to, label } = resolveRange(opts.range);
  const sb = supabaseAdmin;
  const agentFilter = (q: any) => (opts.agent_id ? q.eq("agent_id", opts.agent_id) : q);
  const [callsRes, claimsRes, salesRes, quotedRes] = await Promise.all([
    agentFilter(sb.from("call_logs").select("id, duration_seconds, agent_id").gte("created_at", from).lt("created_at", to)),
    agentFilter(sb.from("leads").select("id, agent_id, claimed_at, quoted_premium").gte("claimed_at", from).lt("claimed_at", to)),
    sb.from("sale_events").select("id, agent_id, premium_amount, created_at").gte("created_at", from).lt("created_at", to).filter("agent_id", opts.agent_id ? "eq" : "not.is", opts.agent_id ?? null),
    agentFilter(sb.from("leads").select("id, agent_id, quoted_premium").gte("updated_at", from).lt("updated_at", to).not("quoted_premium", "is", null)),
  ]);
  type Row = { agent_id: string | null; calls: number; claimed: number; quoted: number; sales: number; premium: number };
  const m = new Map<string, Row>();
  const ensure = (id: string | null) => {
    const k = id ?? "unassigned";
    if (!m.has(k)) m.set(k, { agent_id: id, calls: 0, claimed: 0, quoted: 0, sales: 0, premium: 0 });
    return m.get(k)!;
  };
  for (const r of callsRes.data ?? []) ensure((r as any).agent_id).calls++;
  for (const r of claimsRes.data ?? []) ensure((r as any).agent_id).claimed++;
  for (const r of quotedRes.data ?? []) ensure((r as any).agent_id).quoted++;
  for (const r of salesRes.data ?? []) { const x = ensure((r as any).agent_id); x.sales++; x.premium += Number((r as any).premium_amount ?? 0); }
  const ids = Array.from(m.values()).map((v) => v.agent_id).filter((x): x is string => !!x);
  const { data: profs } = ids.length
    ? await sb.from("profiles").select("id, full_name, email").in("id", ids)
    : { data: [] as any };
  const pmap = new Map((profs ?? []).map((p: any) => [p.id, p.full_name ?? p.email ?? "Agent"]));
  const rows = Array.from(m.values()).map((r) => ({
    agent_id: r.agent_id,
    agent: r.agent_id ? pmap.get(r.agent_id) ?? "Agent" : "Unassigned",
    calls: r.calls,
    claimed: r.claimed,
    quoted: r.quoted,
    sales: r.sales,
    premium: r.premium,
    quote_rate: r.claimed ? +(r.quoted / r.claimed).toFixed(3) : 0,
    close_rate: r.claimed ? +(r.sales / r.claimed).toFixed(3) : 0,
  })).sort((a, b) => b.sales - a.sales);
  return { range: label, from, to, agents: rows, as_of: new Date().toISOString() };
}

export async function vendorPerformance(opts: { vendor_id?: string; range: Range }) {
  const { from, to, label } = resolveRange(opts.range);
  const sb = supabaseAdmin;
  let leadsQ = sb.from("leads").select("id, vendor_id, dispo, quoted_premium, vendor_payout, claimed_at, created_at").gte("created_at", from).lt("created_at", to);
  if (opts.vendor_id) leadsQ = leadsQ.eq("vendor_id", opts.vendor_id);
  const { data: leads } = await leadsQ;
  type V = { vendor_id: string; total: number; claimed: number; quoted: number; sold: number; payout: number; premium: number };
  const m = new Map<string, V>();
  for (const l of leads ?? []) {
    const id = (l as any).vendor_id as string | null;
    if (!id) continue;
    if (!m.has(id)) m.set(id, { vendor_id: id, total: 0, claimed: 0, quoted: 0, sold: 0, payout: 0, premium: 0 });
    const x = m.get(id)!;
    x.total++;
    if ((l as any).claimed_at) x.claimed++;
    if ((l as any).quoted_premium != null) x.quoted++;
    if (["sold", "sold_auto", "sold_home", "sold_both"].includes(String((l as any).dispo))) {
      x.sold++;
      x.premium += Number((l as any).quoted_premium ?? 0);
    }
    x.payout += Number((l as any).vendor_payout ?? 0);
  }
  const ids = Array.from(m.keys());
  const { data: vendors } = ids.length
    ? await sb.from("profiles").select("id, company_name, full_name, email").in("id", ids)
    : { data: [] as any };
  const vmap = new Map((vendors ?? []).map((v: any) => [v.id, v.company_name ?? v.full_name ?? v.email ?? "Vendor"]));
  const rows = Array.from(m.values()).map((v) => ({
    vendor_id: v.vendor_id,
    vendor: vmap.get(v.vendor_id) ?? "Vendor",
    leads: v.total,
    claimed: v.claimed,
    quoted: v.quoted,
    sold: v.sold,
    premium: v.premium,
    spend: v.payout,
    cost_per_lead: v.total ? +(v.payout / v.total).toFixed(2) : 0,
    cost_per_sale: v.sold ? +(v.payout / v.sold).toFixed(2) : 0,
    close_rate: v.claimed ? +(v.sold / v.claimed).toFixed(3) : 0,
  })).sort((a, b) => b.sold - a.sold);
  return { range: label, from, to, vendors: rows, as_of: new Date().toISOString() };
}

export async function untouchedLeads(opts: { older_than_minutes: number; limit?: number }) {
  const cutoff = new Date(Date.now() - opts.older_than_minutes * 60_000).toISOString();
  const { data } = await supabaseAdmin
    .from("leads")
    .select("id, first_name, last_name, phone, dispo, vendor_id, agent_id, claimed_at, created_at")
    .lte("created_at", cutoff)
    .is("claimed_at", null)
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 50);
  return {
    cutoff,
    leads: (data ?? []).map((l: any) => ({
      id: l.id,
      name: [l.first_name, l.last_name].filter(Boolean).join(" ") || l.phone || "Lead",
      phone: l.phone,
      dispo: l.dispo,
      created_at: l.created_at,
      age_minutes: Math.round((Date.now() - new Date(l.created_at).getTime()) / 60000),
    })),
    as_of: new Date().toISOString(),
  };
}

export async function leadPriorityList(opts: { agent_id?: string; limit?: number }) {
  let q = supabaseAdmin
    .from("leads")
    .select("id, first_name, last_name, phone, dispo, composite_score, score_tier, follow_up_at, x_date, claimed_at, agent_id")
    .is("archived_at", null)
    .order("composite_score", { ascending: false, nullsFirst: false })
    .limit(opts.limit ?? 25);
  if (opts.agent_id) q = q.eq("agent_id", opts.agent_id);
  const { data } = await q;
  return {
    leads: (data ?? []).map((l: any) => ({
      id: l.id,
      name: [l.first_name, l.last_name].filter(Boolean).join(" ") || l.phone || "Lead",
      phone: l.phone,
      dispo: l.dispo,
      score: l.composite_score,
      tier: l.score_tier,
      follow_up_at: l.follow_up_at,
      x_date: l.x_date,
    })),
    as_of: new Date().toISOString(),
  };
}

export async function sourceRoi(range: Range) {
  const { from, to, label } = resolveRange(range);
  const { data: leads } = await supabaseAdmin
    .from("leads")
    .select("id, lead_source, vendor_payout, dispo, quoted_premium")
    .gte("created_at", from).lt("created_at", to);
  const m = new Map<string, { source: string; leads: number; sold: number; spend: number; premium: number }>();
  for (const l of leads ?? []) {
    const key = (l as any).lead_source ?? "unknown";
    if (!m.has(key)) m.set(key, { source: key, leads: 0, sold: 0, spend: 0, premium: 0 });
    const x = m.get(key)!;
    x.leads++;
    x.spend += Number((l as any).vendor_payout ?? 0);
    if (String((l as any).dispo).startsWith("sold")) {
      x.sold++;
      x.premium += Number((l as any).quoted_premium ?? 0);
    }
  }
  return {
    range: label,
    sources: Array.from(m.values()).map((s) => ({
      ...s,
      cost_per_sale: s.sold ? +(s.spend / s.sold).toFixed(2) : 0,
      close_rate: s.leads ? +(s.sold / s.leads).toFixed(3) : 0,
    })).sort((a, b) => b.sold - a.sold),
    as_of: new Date().toISOString(),
  };
}

export async function projection(opts: { kind: "sales" | "premium"; goal?: number }) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const { data: sales } = await supabaseAdmin
    .from("sale_events")
    .select("id, premium_amount, created_at")
    .gte("created_at", monthStart.toISOString())
    .lt("created_at", new Date(monthEnd.getTime() + 86400000).toISOString());
  const totalSales = sales?.length ?? 0;
  const totalPremium = (sales ?? []).reduce((s, r: any) => s + Number(r.premium_amount ?? 0), 0);
  const elapsedBd = businessDaysBetween(monthStart, now);
  const totalBd = businessDaysBetween(monthStart, monthEnd);
  const remainingBd = Math.max(totalBd - elapsedBd, 0);
  const current = opts.kind === "sales" ? totalSales : totalPremium;
  const perBd = elapsedBd > 0 ? current / elapsedBd : 0;
  const projected = Math.round(current + perBd * remainingBd);
  let settingsGoal = opts.goal;
  if (settingsGoal == null && opts.kind === "sales") {
    const { data: s } = await supabaseAdmin.from("ai_settings").select("monthly_auto_goal").maybeSingle();
    settingsGoal = (s as any)?.monthly_auto_goal ?? undefined;
  }
  const gap = settingsGoal != null ? settingsGoal - projected : null;
  const per_day_needed = settingsGoal != null && remainingBd > 0
    ? +Math.max((settingsGoal - current) / remainingBd, 0).toFixed(2)
    : null;
  return {
    kind: opts.kind,
    mtd: current,
    business_days_elapsed: elapsedBd,
    business_days_remaining: remainingBd,
    pace_per_business_day: +perBd.toFixed(2),
    projected_eom: projected,
    goal: settingsGoal ?? null,
    gap_to_goal: gap,
    per_business_day_needed: per_day_needed,
    confidence: elapsedBd >= 5 ? "medium" : "low",
    as_of: new Date().toISOString(),
  };
}

export async function neglectedLeads(opts: { hours_since_activity: number; limit?: number }) {
  const cutoff = new Date(Date.now() - opts.hours_since_activity * 3_600_000).toISOString();
  const { data } = await supabaseAdmin
    .from("leads")
    .select("id, first_name, last_name, phone, dispo, agent_id, claimed_at, updated_at")
    .not("claimed_at", "is", null)
    .is("archived_at", null)
    .lte("updated_at", cutoff)
    .not("dispo", "in", "(sold,sold_auto,sold_home,sold_both,dnq,dnc)")
    .order("updated_at", { ascending: true })
    .limit(opts.limit ?? 25);
  return {
    cutoff,
    leads: (data ?? []).map((l: any) => ({
      id: l.id,
      name: [l.first_name, l.last_name].filter(Boolean).join(" ") || l.phone || "Lead",
      dispo: l.dispo,
      last_activity: l.updated_at,
      hours_since: Math.round((Date.now() - new Date(l.updated_at).getTime()) / 3600000),
    })),
    as_of: new Date().toISOString(),
  };
}

export async function trendCompare(opts: { metric: "leads" | "sales" | "premium" | "calls"; range_a: Range; range_b: Range }) {
  const a = resolveRange(opts.range_a);
  const b = resolveRange(opts.range_b);
  const sb = supabaseAdmin;
  async function measure(from: string, to: string) {
    if (opts.metric === "leads") {
      const { count } = await sb.from("leads").select("id", { count: "exact", head: true }).gte("created_at", from).lt("created_at", to);
      return count ?? 0;
    }
    if (opts.metric === "calls") {
      const { count } = await sb.from("call_logs").select("id", { count: "exact", head: true }).gte("created_at", from).lt("created_at", to);
      return count ?? 0;
    }
    const { data } = await sb.from("sale_events").select("premium_amount").gte("created_at", from).lt("created_at", to);
    if (opts.metric === "sales") return data?.length ?? 0;
    return (data ?? []).reduce((s, r: any) => s + Number(r.premium_amount ?? 0), 0);
  }
  const [av, bv] = await Promise.all([measure(a.from, a.to), measure(b.from, b.to)]);
  const delta = av - bv;
  return {
    metric: opts.metric,
    range_a: a.label, value_a: av,
    range_b: b.label, value_b: bv,
    delta,
    pct_change: bv ? +((delta / bv) * 100).toFixed(1) : null,
    as_of: new Date().toISOString(),
  };
}

export async function getSettings() {
  const { data } = await supabaseAdmin.from("ai_settings").select("*").eq("id", 1).maybeSingle();
  return data ?? { id: 1, monthly_auto_goal: 200, close_rate_target: 0.1 };
}

// ============================================================
// Smart historical fallback + weighted activity analysis
// ============================================================

export const FALLBACK_ORDER: Range[] = [
  "today", "week", "last_7d", "last_30d", "last_60d", "last_90d", "ytd", "all_time",
];

export const MIN_SAMPLES = {
  time_of_day: 50,
  day_of_week: 50,
  agent_trend: 20,
  vendor_quality: 25,
  close_rate: 10,
  default: 20,
} as const;

export type ActivityWeights = {
  call_placed: number;
  call_answered: number;
  lead_claimed: number;
  lead_contacted: number;
  quote_created: number;
  sale_bound: number;
  note_added: number;
  task_completed: number;
  transfer_accepted: number;
  status_change: number;
  chat_message: number;
};

export const DEFAULT_WEIGHTS: ActivityWeights = {
  call_placed: 1,
  call_answered: 2,
  lead_claimed: 2,
  lead_contacted: 3,
  quote_created: 4,
  sale_bound: 8,
  note_added: 1,
  task_completed: 1,
  transfer_accepted: 4,
  status_change: 1,
  chat_message: 0.5,
};

function confidenceFor(sampleSize: number, min: number): "high" | "medium" | "low" | "insufficient" {
  if (sampleSize >= min * 4) return "high";
  if (sampleSize >= min * 2) return "medium";
  if (sampleSize >= min) return "low";
  return "insufficient";
}

/**
 * Run `runOnce(range)` against the fallback order; return the first result whose
 * sample_size >= minSamples. If none reach the threshold, return the largest window's result
 * (so the caller has SOMETHING to show) with confidence="insufficient".
 */
export async function withFallback<T extends { sample_size: number }>(
  preferred: Range | undefined,
  minSamples: number,
  runOnce: (range: Range) => Promise<T>,
): Promise<T & {
  range_used: string;
  ranges_tried: string[];
  fallback_used: boolean;
  confidence: "high" | "medium" | "low" | "insufficient";
  reasoning: string;
}> {
  const order: Range[] = [];
  if (preferred && !FALLBACK_ORDER.includes(preferred as never)) order.push(preferred);
  const startIdx = preferred && FALLBACK_ORDER.includes(preferred as never)
    ? FALLBACK_ORDER.indexOf(preferred as never)
    : 0;
  for (let i = startIdx; i < FALLBACK_ORDER.length; i++) order.push(FALLBACK_ORDER[i]);

  const tried: string[] = [];
  let last: T | null = null;
  let lastLabel = "";
  const trail: string[] = [];
  for (const r of order) {
    const { label } = resolveRange(r);
    tried.push(label);
    const res = await runOnce(r);
    last = res; lastLabel = label;
    trail.push(`${label}: ${res.sample_size} samples`);
    if (res.sample_size >= minSamples) {
      const fallback_used = tried.length > 1;
      const conf = confidenceFor(res.sample_size, minSamples);
      const reasoning = fallback_used
        ? `Checked ${tried.slice(0, -1).join(" → ")} (sample too small), expanded to ${label} with ${res.sample_size} samples (min ${minSamples}). Confidence ${conf}.`
        : `${label} had ${res.sample_size} samples (min ${minSamples}). Confidence ${conf}.`;
      return { ...res, range_used: label, ranges_tried: tried, fallback_used, confidence: conf, reasoning };
    }
  }
  return {
    ...(last as T),
    range_used: lastLabel,
    ranges_tried: tried,
    fallback_used: true,
    confidence: "insufficient",
    reasoning: `Even after expanding through ${tried.join(" → ")}, sample size stayed below ${minSamples}. Data is insufficient to answer reliably.`,
  };
}

async function getBusinessTz(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "timezone")
      .maybeSingle();
    const tz = (data as any)?.value?.timezone ?? (data as any)?.value;
    if (typeof tz === "string" && tz.length > 0) return tz;
  } catch { /* ignore */ }
  return "America/New_York";
}

async function getActivityWeights(): Promise<ActivityWeights> {
  try {
    const { data } = await supabaseAdmin
      .from("ai_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    const w = (data as any)?.activity_weights;
    if (w && typeof w === "object") return { ...DEFAULT_WEIGHTS, ...w };
  } catch { /* ignore */ }
  return DEFAULT_WEIGHTS;
}

const SOLD_DISPOS = new Set(["sold", "sold_auto", "sold_home", "sold_both"]);

type HourBucket = {
  calls: number; calls_answered: number; claims: number; contacts: number;
  quotes: number; sales: number; notes: number; tasks: number; transfers: number;
  status_changes: number; messages: number; score: number;
};
function emptyBucket(): HourBucket {
  return {
    calls: 0, calls_answered: 0, claims: 0, contacts: 0,
    quotes: 0, sales: 0, notes: 0, tasks: 0, transfers: 0,
    status_changes: 0, messages: 0, score: 0,
  };
}

function hourInTz(iso: string | null | undefined, tz: string): number | null {
  if (!iso) return null;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false });
    const parts = fmt.formatToParts(new Date(iso));
    const h = parts.find((p) => p.type === "hour")?.value;
    if (!h) return null;
    const n = parseInt(h, 10);
    return n === 24 ? 0 : n;
  } catch { return null; }
}

function dayInTz(iso: string | null | undefined, tz: string): number | null {
  if (!iso) return null;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
    const v = fmt.format(new Date(iso));
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[v] ?? null;
  } catch { return null; }
}

/** Pull all activity events in a window, bucketed by hour-of-day in business tz. */
async function fetchActivityBuckets(range: Range, tz: string, weights: ActivityWeights) {
  const { from, to, label } = resolveRange(range);
  const sb = supabaseAdmin;
  const buckets: HourBucket[] = Array.from({ length: 24 }, emptyBucket);
  const dayBuckets: HourBucket[] = Array.from({ length: 7 }, emptyBucket);

  function bump(iso: string | null, key: keyof HourBucket, weight: number) {
    const h = hourInTz(iso, tz);
    if (h != null) { buckets[h][key]++; buckets[h].score += weight; }
    const d = dayInTz(iso, tz);
    if (d != null) { dayBuckets[d][key]++; dayBuckets[d].score += weight; }
  }

  const [callsRes, leadsRes, actRes, salesRes, msgsRes] = await Promise.all([
    sb.from("call_logs").select("created_at, answered_at, duration_seconds, direction")
      .gte("created_at", from).lt("created_at", to).limit(50000),
    sb.from("leads").select("claimed_at, dispo")
      .gte("claimed_at", from).lt("claimed_at", to)
      .limit(50000),
    sb.from("lead_activities").select("created_at, action")
      .gte("created_at", from).lt("created_at", to).limit(50000),
    sb.from("sale_events").select("created_at")
      .gte("created_at", from).lt("created_at", to).limit(50000),
    sb.from("chat_messages").select("created_at")
      .gte("created_at", from).lt("created_at", to).limit(50000),
  ]);

  for (const r of callsRes.data ?? []) {
    const row = r as any;
    bump(row.created_at, "calls", weights.call_placed);
    if (row.answered_at || (row.duration_seconds ?? 0) > 0) {
      bump(row.answered_at ?? row.created_at, "calls_answered", weights.call_answered);
    }
  }
  for (const r of leadsRes.data ?? []) {
    const row = r as any;
    if (row.claimed_at) bump(row.claimed_at, "claims", weights.lead_claimed);
  }
  for (const r of actRes.data ?? []) {
    const row = r as any;
    const action = String(row.action ?? "").toLowerCase();
    if (action.includes("note") || action === "ai_note") bump(row.created_at, "notes", weights.note_added);
    else if (action.includes("task")) bump(row.created_at, "tasks", weights.task_completed);
    else if (action.includes("quote")) bump(row.created_at, "quotes", weights.quote_created);
    else if (action.includes("transfer")) bump(row.created_at, "transfers", weights.transfer_accepted);
    else if (action.includes("status") || action.includes("dispo")) bump(row.created_at, "status_changes", weights.status_change);
    else bump(row.created_at, "notes", weights.note_added * 0.5);
  }
  for (const r of salesRes.data ?? []) bump((r as any).created_at, "sales", weights.sale_bound);
  for (const r of msgsRes.data ?? []) bump((r as any).created_at, "messages", weights.chat_message);

  const totalEvents =
    (callsRes.data?.length ?? 0) +
    (leadsRes.data?.length ?? 0) +
    (actRes.data?.length ?? 0) +
    (salesRes.data?.length ?? 0) +
    (msgsRes.data?.length ?? 0);

  return { from, to, label, buckets, dayBuckets, sample_size: totalEvents };
}

function topHours(buckets: HourBucket[], n: number): number[] {
  return buckets
    .map((b, hour) => ({ hour, score: b.score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.hour);
}

function bestBlock(buckets: HourBucket[]): { start: number; end: number; score: number } {
  // Best contiguous 3-hour block.
  let best = { start: 0, end: 2, score: -1 };
  for (let i = 0; i <= 21; i++) {
    const s = buckets[i].score + buckets[i + 1].score + buckets[i + 2].score;
    if (s > best.score) best = { start: i, end: i + 2, score: s };
  }
  return best;
}

function fmtHour(h: number): string {
  const am = h < 12;
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:00 ${am ? "AM" : "PM"}`;
}

function recommendationsForPeak(peak: number, block: { start: number; end: number }): string[] {
  const blockStr = `${fmtHour(block.start)}–${fmtHour(block.end + 1)}`;
  return [
    `Push live leads into the queue just before ${fmtHour(peak)} so agents pick them up at peak.`,
    `Schedule sales blitzes inside the ${blockStr} window.`,
    `Avoid team meetings during ${blockStr} — that is the most productive selling window.`,
    `Send team announcements at least 30 minutes before ${fmtHour(block.start)} so they are read before the peak.`,
    `Use the period after ${fmtHour(block.end + 1)} for accountability check-ins and coaching.`,
  ];
}

export async function activityByHour(opts: {
  range?: Range;
  min_samples?: number;
}) {
  const tz = await getBusinessTz();
  const weights = await getActivityWeights();
  const min = opts.min_samples ?? MIN_SAMPLES.time_of_day;

  const result = await withFallback(opts.range, min, async (r) => {
    const b = await fetchActivityBuckets(r, tz, weights);
    return { ...b, sample_size: b.sample_size };
  });

  const { buckets } = result;
  const peakHour = topHours(buckets, 1)[0] ?? 0;
  const top3 = topHours(buckets, 3);
  const block = bestBlock(buckets);

  return {
    timezone: tz,
    range_used: result.range_used,
    ranges_tried: result.ranges_tried,
    fallback_used: result.fallback_used,
    confidence: result.confidence,
    reasoning: result.reasoning,
    from: result.from,
    to: result.to,
    sample_size: result.sample_size,
    weights_used: weights,
    peak_hour: peakHour,
    peak_hour_label: fmtHour(peakHour),
    top_hours: top3,
    top_hours_label: top3.map(fmtHour),
    top_block: { start: block.start, end: block.end, label: `${fmtHour(block.start)}–${fmtHour(block.end + 1)}`, score: +block.score.toFixed(2) },
    hours: buckets.map((b, hour) => ({ ...b, hour, label: fmtHour(hour), score: +b.score.toFixed(2) })),
    recommendations: result.confidence === "insufficient" ? [] : recommendationsForPeak(peakHour, block),
    data_sources: ["call_logs", "leads", "lead_activities", "sale_events", "chat_messages"],
    as_of: new Date().toISOString(),
  };
}

export async function activityByDayOfWeek(opts: { range?: Range; min_samples?: number }) {
  const tz = await getBusinessTz();
  const weights = await getActivityWeights();
  const min = opts.min_samples ?? MIN_SAMPLES.day_of_week;

  const result = await withFallback(opts.range, min, async (r) => {
    const b = await fetchActivityBuckets(r, tz, weights);
    return { ...b, sample_size: b.sample_size };
  });

  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const days = result.dayBuckets.map((b, idx) => ({ ...b, day: idx, label: names[idx], score: +b.score.toFixed(2) }));
  const peak = [...days].sort((a, b) => b.score - a.score)[0];

  return {
    timezone: tz,
    range_used: result.range_used,
    ranges_tried: result.ranges_tried,
    fallback_used: result.fallback_used,
    confidence: result.confidence,
    reasoning: result.reasoning,
    from: result.from,
    to: result.to,
    sample_size: result.sample_size,
    peak_day: peak?.label,
    days,
    data_sources: ["call_logs", "leads", "lead_activities", "sale_events", "chat_messages"],
    as_of: new Date().toISOString(),
  };
}

/** Compare a metric in `current` against the per-period average over `historical`. */
export async function historicalComparison(opts: {
  metric: "leads" | "sales" | "premium" | "calls" | "activity_events";
  current_range?: Range;
  historical_range?: Range;
}) {
  const cur = resolveRange(opts.current_range ?? "today");
  const hist = resolveRange(opts.historical_range ?? "last_90d");
  const sb = supabaseAdmin;

  async function count(from: string, to: string): Promise<number> {
    if (opts.metric === "leads") {
      const { count } = await sb.from("leads").select("id", { count: "exact", head: true }).gte("created_at", from).lt("created_at", to);
      return count ?? 0;
    }
    if (opts.metric === "calls") {
      const { count } = await sb.from("call_logs").select("id", { count: "exact", head: true }).gte("created_at", from).lt("created_at", to);
      return count ?? 0;
    }
    if (opts.metric === "sales" || opts.metric === "premium") {
      const { data } = await sb.from("sale_events").select("premium_amount").gte("created_at", from).lt("created_at", to);
      if (opts.metric === "sales") return data?.length ?? 0;
      return (data ?? []).reduce((s, r: any) => s + Number(r.premium_amount ?? 0), 0);
    }
    // activity_events
    const [a, b, c, d, e] = await Promise.all([
      sb.from("call_logs").select("id", { count: "exact", head: true }).gte("created_at", from).lt("created_at", to),
      sb.from("lead_activities").select("id", { count: "exact", head: true }).gte("created_at", from).lt("created_at", to),
      sb.from("sale_events").select("id", { count: "exact", head: true }).gte("created_at", from).lt("created_at", to),
      sb.from("chat_messages").select("id", { count: "exact", head: true }).gte("created_at", from).lt("created_at", to),
      sb.from("leads").select("id", { count: "exact", head: true }).gte("claimed_at", from).lt("claimed_at", to),
    ]);
    return (a.count ?? 0) + (b.count ?? 0) + (c.count ?? 0) + (d.count ?? 0) + (e.count ?? 0);
  }

  const [curValue, histTotal] = await Promise.all([count(cur.from, cur.to), count(hist.from, hist.to)]);
  const curMs = new Date(cur.to).getTime() - new Date(cur.from).getTime();
  const histMs = new Date(hist.to).getTime() - new Date(hist.from).getTime();
  const periods = histMs / Math.max(curMs, 1);
  const histAvgPerCurrentWindow = periods > 0 ? histTotal / periods : 0;
  const delta = curValue - histAvgPerCurrentWindow;
  const pct = histAvgPerCurrentWindow > 0 ? +((delta / histAvgPerCurrentWindow) * 100).toFixed(1) : null;

  return {
    metric: opts.metric,
    current_range: cur.label, current_value: curValue,
    historical_range: hist.label, historical_total: histTotal,
    historical_avg_per_current_window: +histAvgPerCurrentWindow.toFixed(2),
    delta: +delta.toFixed(2),
    pct_change_vs_avg: pct,
    verdict: pct == null ? "no_baseline"
      : pct >= 25 ? "unusually_high"
      : pct <= -25 ? "unusually_low"
      : "near_average",
    as_of: new Date().toISOString(),
  };
}