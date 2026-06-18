import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { computeVendorPayments } from "@/lib/vendor-payments.functions";
import { isQuotedDispo } from "@/lib/dispo-scoring";
import { buildLeadSaleRows, type LeadSaleInput } from "@/lib/sale-rows";
import { summarizeLeadSales } from "@/lib/sale-summary";
import { isInitialQuoteActivity, quoteCreditKey } from "@/lib/quote-credit";
import {
  addSpeedSample,
  emptySpeedSummary,
  speedBonus,
  speedToClaimSeconds,
  type SpeedToClaimSummary,
} from "@/lib/speed-to-claim";
import {
  buildEligibilityIndex,
  bumpUnclaimed,
  emptyUnclaimedSummary,
  leadIsUnclaimed,
  wasEligibleAt,
  type CallInterval,
  type PresenceEvent,
  type UnclaimedSummary,
} from "@/lib/unclaimed-rate";

type Lead = {
  id: string;
  vendor_id: string;
  agent_id: string | null;
  referred_by?: string | null;
  dispo: string | null;
  quoted_premium: number | null;
  current_premium: number | null;
  vendor_payout: number | null;
  created_at: string;
  billable_override?: boolean | null;
  auto_policies_count?: number | null;
  home_dispo?: string | null;
  home_quoted_premium?: number | null;
  home_policies_count?: number | null;
  auto_motor_club_premium?: number | null;
  first_name?: string | null;
  last_name?: string | null;
  claimed_at?: string | null;
  home_claimed_at?: string | null;
};

type ProfileRow = { id: string; full_name: string | null; company_name: string | null; email: string; avatar_url: string | null };
type ProfileWithRate = ProfileRow & { default_lead_rate: number | null };

type ActivityRow = {
  user_id: string | null;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
  lead_id: string | null;
  lead_table: string | null;
};

type SoldAnalyticsLead = {
  id: string;
  updated_at: string | null;
  dispo: string | null;
  home_dispo: string | null;
  claimed_by: string | null;
  home_claimed_by: string | null;
  quoted_premium: number | null;
  home_quoted_premium: number | null;
  auto_policies_count: number | null;
  home_policies_count: number | null;
  auto_motor_club_premium: number | null;
  num_vehicles: number | null;
  lead_lines: unknown;
  /** Injected by the caller so we can join authoritative sale_events. */
  __table?: "leads" | "list_leads";
};

type LeadLine = {
  dispo?: string | null;
  claimed_by?: string | null;
  quoted_premium?: number | string | null;
  items?: number | string | null;
  sold_at?: string | null;
};

type SaleRow = {
  ownerId: string;
  occurredAt: string | null;
  leadId: string;
  leadTable: "leads" | "list_leads" | null;
  side: string;
  items: number;
  premium: number;
};

// Weights for the sales-agent activity score. Tuned so calls + dispo work
// matter more than passive edits, with a bonus for productive call outcomes.
const ACTIVITY_WEIGHTS: Record<string, number> = {
  claimed: 1,
  released: 0,
  reassigned: 1,
  dispo_changed: 2,
  quoted_premium_changed: 3,
  agent_notes_edited: 1,
  call_logged: 2,
  email_sent: 2,
};
ACTIVITY_WEIGHTS.line_premium_changed = 3;
const CONNECTED_BONUS = 3;

const isInitialQuote = isInitialQuoteActivity;
// When a dispo_changed activity lands on a real quote-tier dispo
// (quoted, sold, follow_up, x_date), bump the score so meaningful
// outcomes outweigh "marked it dead" toggles.
const QUOTED_DISPO_BONUS = 2;

function scoreActivity(a: ActivityRow): number {
  const base = ACTIVITY_WEIGHTS[a.action] ?? 0;
  if (a.action === "call_logged") {
    const outcome = String((a.details as any)?.outcome ?? "");
    if (outcome.startsWith("connected_")) return base + CONNECTED_BONUS;
  }
  if (a.action === "dispo_changed") {
    const to = String((a.details as any)?.to ?? "");
    if (isQuotedDispo(to)) return base + QUOTED_DISPO_BONUS;
  }
  if (a.action === "quoted_premium_changed" || a.action === "line_premium_changed") {
    return isInitialQuote(a) ? base : 0;
  }
  // Taking a live lead counts as a connected call: the agent picked up a
  // transfer and is talking to the prospect right now.
  if (a.action === "claimed" && a.lead_table === "leads") {
    return (ACTIVITY_WEIGHTS.call_logged ?? 0) + CONNECTED_BONUS;
  }
  return base;
}

// ---- Timezone-aware day boundaries ----
// Server runs in UTC (Cloudflare Workers), so the user's "today" must be
// resolved against an IANA timezone supplied by the caller. These helpers
// return UTC `Date` objects that correspond to local midnight in `tz`.

function isValidTz(tz: string | undefined | null): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Read wall-clock Y/M/D/h/m/s for `instant` as observed in `tz`. */
function wallPartsInTz(instant: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24, // Intl can emit "24" for midnight
    minute: get("minute"),
    second: get("second"),
  };
}

/** Convert a wall-clock date/time in `tz` to the equivalent UTC instant. */
function zonedWallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const w = wallPartsInTz(new Date(utcGuess), tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const offset = asUtc - utcGuess; // tz offset in ms at that instant
  return new Date(utcGuess - offset);
}

function startOfDay(d: Date = new Date(), tz: string = "UTC"): Date {
  if (!isValidTz(tz)) tz = "UTC";
  const w = wallPartsInTz(d, tz);
  return zonedWallToUtc(w.year, w.month, w.day, 0, 0, tz);
}

// Collapse repeat actions of the same type for the same (user, lead) within
// a short window. Keeps the earliest row in time and drops follow-ups so the
// agent isn't credited multiple times for what amounts to one action.
function dedupeRapidActions<T extends { user_id?: string | null; lead_id?: string | null; lead_table?: string | null; action: string; created_at: string }>(
  rows: T[],
  actions: string[],
  windowMs: number,
): T[] {
  const targets = new Set(actions);
  // Sort ascending by time so we keep the earliest occurrence per bucket.
  const sorted = [...rows].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const lastAt = new Map<string, number>();
  const keep = new Set<T>();
  for (const r of sorted) {
    if (!targets.has(r.action)) { keep.add(r); continue; }
    const key = `${r.user_id ?? ""}|${r.lead_table ?? ""}|${r.lead_id ?? ""}|${r.action}`;
    const ts = new Date(r.created_at).getTime();
    const prev = lastAt.get(key);
    if (prev !== undefined && ts - prev <= windowMs) continue; // duplicate within window
    lastAt.set(key, ts);
    keep.add(r);
  }
  // Preserve original order (rows were likely created_at desc).
  return rows.filter((r) => keep.has(r));
}
function startOfWeek(d: Date = new Date(), tz: string = "UTC"): Date {
  if (!isValidTz(tz)) tz = "UTC";
  const w = wallPartsInTz(d, tz);
  const localMidnight = zonedWallToUtc(w.year, w.month, w.day, 0, 0, tz);
  // Determine local day-of-week by reading the wall date back in tz
  const weekdayName = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(localMidnight);
  const dowMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dow = dowMap[weekdayName] ?? 0;
  // Subtract `dow` days, recomputing through the wall clock to handle DST.
  const back = new Date(localMidnight.getTime() - dow * 24 * 3600 * 1000);
  const bw = wallPartsInTz(back, tz);
  return zonedWallToUtc(bw.year, bw.month, bw.day, 0, 0, tz);
}

function startOfMonth(d: Date = new Date(), tz: string = "UTC"): Date {
  if (!isValidTz(tz)) tz = "UTC";
  const w = wallPartsInTz(d, tz);
  return zonedWallToUtc(w.year, w.month, 1, 0, 0, tz);
}

function isSoldDispo(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase() === "sold";
}

function buildSaleRows(leads: SoldAnalyticsLead[]): SaleRow[] {
  const rows: SaleRow[] = [];
  for (const lead of leads) {
    for (const r of buildLeadSaleRows(lead as LeadSaleInput)) {
      rows.push({
        ownerId: r.ownerId,
        occurredAt: r.occurredAt,
        leadId: r.leadId,
        leadTable: lead.__table ?? null,
        side: r.side,
        items: r.items,
        premium: r.premium,
      });
    }
  }
  return rows;
}

export const getAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { view?: "self" | "team"; agentId?: string | null; asUserId?: string | null; tz?: string | null } | undefined) =>
      input ?? {},
  )
  .handler(async ({ context, data }) => {
    let userId = context.userId;
    const requestedView: "self" | "team" = data?.view ?? "self";
    const requestedAgentId = data?.agentId ?? null;
    const tz: string = isValidTz(data?.tz ?? undefined) ? (data!.tz as string) : "UTC";

    // Admin "view-as" impersonation: if the caller is an admin and passes
    // asUserId, run analytics as that user so the scope/role checks reflect
    // what the impersonated user would actually see.
    if (data?.asUserId && data.asUserId !== userId) {
      const { data: callerRoles } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId);
      const callerIsAdmin = (callerRoles ?? []).some((r) => r.role === "admin");
      if (callerIsAdmin) userId = data.asUserId;
    }

    // Sub-agents (users with a parent_vendor_id) must not see analytics —
    // vendors hide revenue/lead-cost from agents who submit on their behalf.
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("parent_vendor_id")
      .eq("id", userId)
      .maybeSingle();
    if (prof?.parent_vendor_id) {
      throw new Error("Forbidden: analytics are not available to sub-agents.");
    }

    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roles = (roleRows ?? []).map((r) => r.role as string);
    const isAdmin = roles.includes("admin");
    const isVendorRole = roles.includes("vendor");
    // Vendor takes precedence over sales so vendor accounts (even if they
    // also carry a sales role) get the vendor-scoped Performance view.
    const isSales = roles.includes("sales") && !isVendorRole;
    const hideCost = isSales;

    // Pull last 60 days of leads (enough for day/week/month windows)
    const since = new Date();
    since.setDate(since.getDate() - 60);

    // Resolve the effective agent filter based on role + requested view.
    //  - admin: no filter by default; may pin to a specific agentId
    //  - sales: default to self; "team" removes the filter so they can
    //    benchmark themselves against peers
    //  - vendor: unchanged (scoped by vendor_id below)
    let effectiveAgentId: string | null = null;
    if (isAdmin) {
      effectiveAgentId = requestedAgentId;
    } else if (isSales) {
      effectiveAgentId = requestedView === "team" ? null : userId;
    }

    let query = supabaseAdmin
      .from("leads")
      .select("id, vendor_id, agent_id, referred_by, dispo, quoted_premium, current_premium, vendor_payout, billable_override, created_at, auto_policies_count, home_dispo, home_quoted_premium, home_policies_count, auto_motor_club_premium, first_name, last_name, claimed_at, home_claimed_at")
      .gte("created_at", since.toISOString());

    if (isSales || isAdmin) {
      if (effectiveAgentId) query = query.eq("agent_id", effectiveAgentId);
    } else {
      // vendor scope
      query = query.eq("vendor_id", userId);
    }

    const { data: leadsData, error } = await query;
    if (error) throw new Error(error.message);
    const leads = (leadsData ?? []) as Lead[];

    // Lookup table for speed-to-claim: lead.id -> created_at. Used to
    // compute seconds between lead creation and the claim activity.
    const leadCreatedById = new Map<string, string>();
    for (const l of leads) {
      if (l.created_at) leadCreatedById.set(l.id, l.created_at);
    }

    // Pull platform activity (lead_activities log) for the same 60d window.
    // Sales/vendor scopes only see their own rows; admins see everyone.
    let activityQuery = supabaseAdmin
      .from("lead_activities")
      .select("user_id, action, details, created_at, lead_id, lead_table")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .range(0, 49999);
    // NOTE: do NOT filter activity by effectiveAgentId — the Activity
    // Leaderboard is meant to show every agent regardless of whether the
    // sales user is viewing "self" vs "team". Per-agent KPIs are still
    // derived from `myActivity` which looks up the user_id in the result.
    if (!isSales && !isAdmin) {
      activityQuery = activityQuery.eq("user_id", userId);
    }

    const soldCols =
      "id, vendor_id, updated_at, dispo, home_dispo, claimed_by, home_claimed_by, quoted_premium, home_quoted_premium, auto_policies_count, home_policies_count, auto_motor_club_premium, num_vehicles, lead_lines, first_name, last_name";

    // Match the details endpoint exactly: filter sold-only rows at the DB,
    // order by most-recent so the implicit page returns the freshest sales
    // (not the oldest 1000), and lift the limit so we cover every agent's
    // sold history within the 60-day analytics window.
    let liveSoldQuery = supabaseAdmin
      .from("leads")
      .select(soldCols)
      .or("dispo.eq.sold,home_dispo.eq.sold")
      .order("updated_at", { ascending: false })
      .limit(5000);
    let listSoldQuery = supabaseAdmin
      .from("list_leads")
      .select(soldCols)
      .or("dispo.eq.sold,home_dispo.eq.sold")
      .order("updated_at", { ascending: false })
      .limit(5000);
    if (!isSales && !isAdmin) {
      liveSoldQuery = liveSoldQuery.eq("vendor_id", userId);
      listSoldQuery = listSoldQuery.eq("vendor_id", userId);
    }

    // Authoritative per-sale timestamps. lead.updated_at moves on every edit
    // (notes, premium tweaks, other-side dispo changes, vendor sync), so
    // using it for "when was this sold" misclassifies older sales as today.
    let saleEventsQuery = supabaseAdmin
      .from("sale_events")
      .select("lead_id, lead_table, side, created_at, agent_id")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(20000);
    if ((isSales || isAdmin) && effectiveAgentId) {
      saleEventsQuery = saleEventsQuery.eq("agent_id", effectiveAgentId);
    }

    const [{ data: activityData }, liveSoldRes, listSoldRes, saleEventsRes, presenceRes, callsRes] = await Promise.all([
      activityQuery,
      liveSoldQuery,
      listSoldQuery,
      saleEventsQuery,
      // Presence history covering the same window (with 7d lookback so the
      // status at the first pop is known) + active call intervals.
      supabaseAdmin
        .from("presence_events")
        .select("user_id, status, started_at")
        .gte("started_at", new Date(since.getTime() - 7 * 24 * 3600 * 1000).toISOString()),
      Promise.resolve({ data: [] as Array<{ user_id: string | null; started_at: string | null; ended_at: string | null }> }),
    ]);
    const activities = (activityData ?? []) as ActivityRow[];
    // Collapse rapid-fire duplicate email_sent rows to the same lead by the
    // same agent (e.g. user clicks "Send" twice or follows several post-call
    // prompts). Without this, the agent gets multiple credits for what is
    // really one outreach. Window: 30 minutes per (user, lead).
    const dedupedActivities = dedupeRapidActions(activities, ["email_sent"], 30 * 60_000);
    // Replace the original reference so downstream filters use the deduped set.
    // (Keep the same name to minimize diff surface.)
    (activities as ActivityRow[]).length = 0;
    (activities as ActivityRow[]).push(...dedupedActivities);
    if (liveSoldRes.error) throw new Error(liveSoldRes.error.message);
    if (listSoldRes.error) throw new Error(listSoldRes.error.message);

    // Build authoritative timestamp map keyed by (lead_table, lead_id, side).
    // Keep the EARLIEST event per key — that's the moment the sale actually
    // happened. Later duplicate inserts (re-dispo, manual fixups) shouldn't
    // make an old sale look fresh.
    const saleEventAt = new Map<string, string>();
    for (const ev of (saleEventsRes?.data ?? []) as Array<{
      lead_id: string; lead_table: string; side: string; created_at: string;
    }>) {
      const key = `${ev.lead_table}:${ev.lead_id}:${ev.side}`;
      const prev = saleEventAt.get(key);
      if (!prev || new Date(ev.created_at).getTime() < new Date(prev).getTime()) {
        saleEventAt.set(key, ev.created_at);
      }
    }

    let liveSold = ((liveSoldRes.data ?? []) as SoldAnalyticsLead[]).map(
      (l) => ({ ...l, __table: "leads" as const }),
    );
    let listSold = ((listSoldRes.data ?? []) as SoldAnalyticsLead[]).map(
      (l) => ({ ...l, __table: "list_leads" as const }),
    );

    // Backfill: the auto/home `.or("dispo.eq.sold,home_dispo.eq.sold")` filter
    // above misses leads whose ONLY sold side is an extra line (flood,
    // umbrella, boat, etc. stored in lead_lines). sale_events is the
    // authoritative source of every sale, so we use it to find any missing
    // lead IDs and fetch those rows explicitly.
    const haveLive = new Set(liveSold.map((l) => l.id));
    const haveList = new Set(listSold.map((l) => l.id));
    const missingLive: string[] = [];
    const missingList: string[] = [];
    for (const ev of (saleEventsRes?.data ?? []) as Array<{
      lead_id: string; lead_table: string;
    }>) {
      if (ev.lead_table === "leads" && !haveLive.has(ev.lead_id)) missingLive.push(ev.lead_id);
      else if (ev.lead_table === "list_leads" && !haveList.has(ev.lead_id)) missingList.push(ev.lead_id);
    }
    if (missingLive.length || missingList.length) {
      const fetchMissing = async (table: "leads" | "list_leads", ids: string[]) => {
        if (!ids.length) return [] as SoldAnalyticsLead[];
        // Chunk to keep URL length sane.
        const out: SoldAnalyticsLead[] = [];
        const unique = Array.from(new Set(ids));
        for (let i = 0; i < unique.length; i += 200) {
          let q = supabaseAdmin.from(table).select(soldCols).in("id", unique.slice(i, i + 200));
          if (!isSales && !isAdmin) q = q.eq("vendor_id", userId);
          const { data, error } = await q;
          if (error) throw new Error(error.message);
          out.push(...((data ?? []) as SoldAnalyticsLead[]));
        }
        return out;
      };
      const [extraLive, extraList] = await Promise.all([
        fetchMissing("leads", missingLive),
        fetchMissing("list_leads", missingList),
      ]);
      liveSold = liveSold.concat(extraLive.map((l) => ({ ...l, __table: "leads" as const })));
      listSold = listSold.concat(extraList.map((l) => ({ ...l, __table: "list_leads" as const })));
    }

    const saleRows = buildSaleRows([...liveSold, ...listSold])
      .map((row) => {
        const key = `${row.leadTable}:${row.leadId}:${row.side}`;
        const authoritative = saleEventAt.get(key);
        return authoritative ? { ...row, occurredAt: authoritative } : row;
      })
      .filter((row) => (!effectiveAgentId || row.ownerId === effectiveAgentId));

    // Surface the list of sales agents. Admins use it for the agent
    // picker; the Activity Leaderboard also uses it so every agent shows
    // up (even ones with zero activity in the window).
    let agents: { id: string; name: string }[] = [];
    let allAgentIds: string[] = [];
    if (isAdmin || isSales) {
      const { data: salesRoleRows } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .in("role", ["sales", "admin"]);
      allAgentIds = Array.from(
        new Set((salesRoleRows ?? []).map((r) => r.user_id as string)),
      );
      if (allAgentIds.length) {
        const { data: agentProfs } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name, email")
          .in("id", allAgentIds);
        agents = (agentProfs ?? [])
          .map((p) => ({
            id: p.id as string,
            name:
              (p.full_name as string | null) ||
              (p.email as string | null) ||
              "Unknown",
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    }

    // Resolve names for vendors + agents
    const ids = Array.from(
      new Set(
        [
          ...leads.flatMap((l) => [l.vendor_id, l.agent_id, l.referred_by].filter(Boolean) as string[]),
          ...saleRows.map((s) => s.ownerId),
          ...(activities.map((a) => a.user_id).filter(Boolean) as string[]),
          ...allAgentIds,
        ],
      ),
    );
    const profilesById = new Map<string, ProfileRow>();
    const vendorRateById = new Map<string, number>();
    if (ids.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, company_name, email, default_lead_rate, avatar_url")
        .in("id", ids);
      for (const p of (profs ?? []) as ProfileWithRate[]) {
        profilesById.set(p.id, p);
        if (p.default_lead_rate != null) vendorRateById.set(p.id, Number(p.default_lead_rate));
      }
    }
    const nameOf = (id: string | null) => {
      if (!id) return "Unassigned";
      const p = profilesById.get(id);
      return p?.full_name || p?.email || "Unknown";
    };
    const avatarOf = (id: string | null): string | null => {
      if (!id) return null;
      return profilesById.get(id)?.avatar_url ?? null;
    };
    const vendorNameOf = (id: string | null) => {
      if (!id) return "Unassigned";
      const p = profilesById.get(id);
      return p?.company_name || p?.full_name || p?.email || "Unknown";
    };

    const dayStart = startOfDay(new Date(), tz).getTime();
    const weekStart = startOfWeek(new Date(), tz).getTime();
    const monthStart = startOfMonth(new Date(), tz).getTime();

    // ---- Unclaimed-rate setup ----
    const presenceRows = (presenceRes?.data ?? []) as PresenceEvent[];
    const callRows = ((callsRes?.data ?? []) as Array<{
      user_id: string | null; started_at: string | null; ended_at: string | null;
    }>)
      .filter((c): c is CallInterval => !!c.user_id && !!c.started_at)
      .map((c) => ({ user_id: c.user_id, started_at: c.started_at, ended_at: c.ended_at }));
    const eligIdx = buildEligibilityIndex(presenceRows, callRows);

    /** Build per-agent unclaimed summary across `leads` whose created_at
     *  falls in [fromMs, now). Eligibility resolved per-pop. */
    const unclaimedFor = (fromMs: number): Map<string, UnclaimedSummary> => {
      const m = new Map<string, UnclaimedSummary>();
      const ensureU = (id: string): UnclaimedSummary => {
        const u = m.get(id) ?? emptyUnclaimedSummary();
        m.set(id, u);
        return u;
      };
      for (const aid of allAgentIds) ensureU(aid);
      for (const l of leads) {
        const popTs = new Date(l.created_at).getTime();
        if (!Number.isFinite(popTs) || popTs < fromMs) continue;
        if (eligIdx.trackingSince != null && popTs < eligIdx.trackingSince) continue;
        const missed = leadIsUnclaimed({
          id: l.id,
          created_at: l.created_at,
          claimed_at: l.claimed_at ?? null,
          home_claimed_at: l.home_claimed_at ?? null,
        });
        for (const agentId of allAgentIds) {
          if (!wasEligibleAt(agentId, popTs, eligIdx)) continue;
          bumpUnclaimed(ensureU(agentId), missed);
        }
      }
      return m;
    };

    const inWindow = (l: Lead, from: number) =>
      new Date(l.created_at).getTime() >= from;

    // KPIs
    const today = leads.filter((l) => inWindow(l, dayStart));
    const week = leads.filter((l) => inWindow(l, weekStart));
    const month = leads.filter((l) => inWindow(l, monthStart));

    const salesInWindow = (from: number) =>
      saleRows.filter((row) => !!row.occurredAt && new Date(row.occurredAt).getTime() >= from);

    // "Quoted" for analytics includes any dispo where the agent engaged the
    // prospect enough to quote: explicit quotes, sales, plus follow-ups and
    // x-dates. Auto and Home sides are evaluated independently — a single
    // lead can sell auto + home (2 policies) or just one side.
    const autoSold = (l: Lead) => isSoldDispo(l.dispo);
    const homeSold = (l: Lead) => isSoldDispo(l.home_dispo);
    const autoQuoted = (l: Lead) => isQuotedDispo(l.dispo);
    const homeQuoted = (l: Lead) => isQuotedDispo(l.home_dispo);
    const soldLeads = leads.filter((l) => autoSold(l) || homeSold(l));
    const sold = soldLeads; // kept as alias for downstream code
    const soldRowsAll = saleRows;
    const soldRowsToday = salesInWindow(dayStart);
    const premiumSold = soldRowsAll.reduce((s, row) => s + row.premium, 0);
    const premiumSoldToday = soldRowsToday.reduce((s, row) => s + row.premium, 0);
    const quoted = leads.filter((l) => autoQuoted(l) || homeQuoted(l));
    const totalPoliciesSold = soldRowsAll.length;
    const closeRate = quoted.length ? (sold.length / quoted.length) * 100 : 0;

    // Per-window KPIs so every tile reflects the user-selected timeframe.
    // sold = number of policies sold (auto + home counted separately).
    const kpiFor = (arr: Lead[]) => {
      const sList = arr.filter((l) => autoSold(l) || homeSold(l));
      const sRows = salesInWindow(
        arr === today ? dayStart : arr === week ? weekStart : monthStart,
      );
      const q = arr.filter((l) => autoQuoted(l) || homeQuoted(l));
      const policies = sRows.length;
      const prem = sRows.reduce((acc, row) => acc + row.premium, 0);
      const items = sRows.reduce((acc, row) => acc + (row.items || 0), 0);
      return {
        leads: arr.length,
        sold: policies,
        items,
        soldLeads: sList.length,
        premium: prem,
        closeRate: q.length ? (sList.length / q.length) * 100 : 0,
      };
    };
    const kpisByWindow = {
      today: kpiFor(today),
      week: kpiFor(week),
      month: kpiFor(month),
    };

    // Leads by vendor (current month) — group by normalized company name so that
    // multiple agent accounts belonging to the same vendor roll up together. We
    // also fuzzy-match look-alike names (lowercase, strip punctuation/whitespace,
    // common suffixes like "inc", "llc"), and display the most-common original
    // spelling as the canonical label.
    const normalizeVendorKey = (raw: string) =>
      raw
        .toLowerCase()
        .replace(/[\p{P}\p{S}]/gu, " ")
        .replace(/\b(inc|llc|ltd|corp|co|company|the|group|agency|insurance|ins)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const vendorGroups = new Map<
      string,
      { count: number; labelCounts: Map<string, number> }
    >();
    for (const l of month) {
      const display = vendorNameOf(l.vendor_id);
      const key = normalizeVendorKey(display) || l.vendor_id;
      const g = vendorGroups.get(key) ?? { count: 0, labelCounts: new Map() };
      g.count += 1;
      g.labelCounts.set(display, (g.labelCounts.get(display) ?? 0) + 1);
      vendorGroups.set(key, g);
    }
    const leadsByVendor = Array.from(vendorGroups.entries())
      .map(([key, g]) => {
        const canonical = Array.from(g.labelCounts.entries()).sort(
          (a, b) => b[1] - a[1],
        )[0][0];
        return { id: key, name: canonical, count: g.count };
      })
      .sort((a, b) => b.count - a.count);

    // Vendor revenue / lead cost — fall back to the vendor's current
    // default_lead_rate when an individual lead has no payout set yet.
    const costOf = (l: Lead) => {
      // Respect admin "non-billable" override — these leads are not charged
      // to the vendor and must not contribute to the lead-cost totals.
      if (l.billable_override === false) return 0;
      const explicit = Number(l.vendor_payout);
      if (explicit > 0) return explicit;
      return vendorRateById.get(l.vendor_id) ?? 0;
    };
    const sumPayout = (arr: Lead[]) => arr.reduce((s, l) => s + costOf(l), 0);
    const payoutTotal = hideCost ? 0 : sumPayout(leads);
    let payoutMonth = hideCost ? 0 : sumPayout(month);
    let payoutWeek = hideCost ? 0 : sumPayout(week);
    let payoutToday = hideCost ? 0 : sumPayout(today);
    const paidLeads = hideCost ? 0 : leads.filter((l) => costOf(l) > 0).length;
    const unpaidLeads = hideCost ? 0 : leads.length - paidLeads;

    // For vendor-scope views, mirror the My Leads breakdown which applies the
    // full billable rules (min vehicles, max age, dispo, claimed, list flags)
    // and includes list_leads. Without this, the KPI tiles drift from the
    // breakdown's "Total earned".
    if (isVendorRole) {
      try {
        const vp = await computeVendorPayments(userId);
        payoutToday = vp.totals.today;
        payoutWeek = vp.totals.week;
        payoutMonth = vp.totals.month;
      } catch {
        // fall back to lead-only payout if vendor profile lookup fails
      }
    }

    // Top agents for sales leaderboard should reflect current sold ownership
    // and the time the sale was recorded on the lead/line itself.
    const topAgents = (from: number) => {
      const takenCounts = new Map<string, number>();
      for (const l of leads) {
        if (!l.agent_id) continue;
        takenCounts.set(l.agent_id, (takenCounts.get(l.agent_id) ?? 0) + 1);
      }

      const m = new Map<string, { taken: number; sold: number; premium: number }>();
      for (const evt of salesInWindow(from)) {
        const cur = m.get(evt.ownerId) ?? {
          taken: takenCounts.get(evt.ownerId) ?? 0,
          sold: 0,
          premium: 0,
        };
        cur.sold += 1;
        cur.premium += evt.premium;
        m.set(evt.ownerId, cur);
      }

      return Array.from(m.entries())
        .map(([id, v]) => ({ id, name: nameOf(id), avatarPath: avatarOf(id), ...v }))
        .sort((a, b) => b.sold - a.sold || b.premium - a.premium || b.taken - a.taken);
    };

    // 14-day trend
    const trend: { date: string; leads: number; sold: number; revenue: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const base = startOfDay(new Date(), tz);
      const d = startOfDay(new Date(base.getTime() - i * 24 * 3600 * 1000), tz);
      const next = startOfDay(new Date(d.getTime() + 25 * 3600 * 1000), tz); // +25h handles DST spring-forward
      const dayLeads = leads.filter((l) => {
        const t = new Date(l.created_at).getTime();
        return t >= d.getTime() && t < next.getTime();
      });
      trend.push({
        date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        leads: dayLeads.length,
        sold: salesInWindow(d.getTime()).reduce((s, row) => {
          const t = row.occurredAt ? new Date(row.occurredAt).getTime() : -1;
          return s + (t >= d.getTime() && t < next.getTime() ? 1 : 0);
        }, 0),
        revenue: hideCost ? 0 : sumPayout(dayLeads),
      });
    }

    // 8-week trend (grouped by week starting Sunday)
    const trendWeek: { date: string; leads: number; sold: number; revenue: number }[] = [];
    for (let i = 7; i >= 0; i--) {
      const base = startOfWeek(new Date(), tz);
      const d = startOfWeek(new Date(base.getTime() - i * 7 * 24 * 3600 * 1000), tz);
      const next = startOfWeek(new Date(d.getTime() + 8 * 24 * 3600 * 1000), tz);
      const wLeads = leads.filter((l) => {
        const t = new Date(l.created_at).getTime();
        return t >= d.getTime() && t < next.getTime();
      });
      trendWeek.push({
        date: `Wk ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
        leads: wLeads.length,
        sold: salesInWindow(d.getTime()).reduce((s, row) => {
          const t = row.occurredAt ? new Date(row.occurredAt).getTime() : -1;
          return s + (t >= d.getTime() && t < next.getTime() ? 1 : 0);
        }, 0),
        revenue: hideCost ? 0 : sumPayout(wLeads),
      });
    }

    // 6-month trend
    const trendMonth: { date: string; leads: number; sold: number; revenue: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const baseM = startOfMonth(new Date(), tz);
      const bw = wallPartsInTz(baseM, tz);
      const targetMonthIdx = bw.month - 1 - i; // 0-based across year boundaries
      const dY = bw.year + Math.floor(targetMonthIdx / 12);
      const dM = ((targetMonthIdx % 12) + 12) % 12 + 1;
      const d = zonedWallToUtc(dY, dM, 1, 0, 0, tz);
      const nextM = dM === 12 ? 1 : dM + 1;
      const nextY = dM === 12 ? dY + 1 : dY;
      const next = zonedWallToUtc(nextY, nextM, 1, 0, 0, tz);
      const mLeads = leads.filter((l) => {
        const t = new Date(l.created_at).getTime();
        return t >= d.getTime() && t < next.getTime();
      });
      trendMonth.push({
        date: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        leads: mLeads.length,
        sold: salesInWindow(d.getTime()).reduce((s, row) => {
          const t = row.occurredAt ? new Date(row.occurredAt).getTime() : -1;
          return s + (t >= d.getTime() && t < next.getTime() ? 1 : 0);
        }, 0),
        revenue: hideCost ? 0 : sumPayout(mLeads),
      });
    }

    // Disposition breakdown + leads-by-vendor per window
    const dispoFor = (arr: Lead[]) => {
      const m = new Map<string, number>();
      for (const l of arr) {
        const k = l.dispo ?? "new";
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return Array.from(m.entries()).map(([name, value]) => ({ name, value }));
    };
    const vendorsFor = (arr: Lead[]) => {
      const groups = new Map<string, { count: number; labelCounts: Map<string, number> }>();
      for (const l of arr) {
        const display = vendorNameOf(l.vendor_id);
        const key = normalizeVendorKey(display) || l.vendor_id;
        const g = groups.get(key) ?? { count: 0, labelCounts: new Map() };
        g.count += 1;
        g.labelCounts.set(display, (g.labelCounts.get(display) ?? 0) + 1);
        groups.set(key, g);
      }
      return Array.from(groups.entries())
        .map(([key, g]) => {
          const canonical = Array.from(g.labelCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];
          return { id: key, name: canonical, count: g.count };
        })
        .sort((a, b) => b.count - a.count);
    };
    const dispoBreakdown = dispoFor(month);
    const dispoByWindow = {
      today: dispoFor(today),
      week: dispoFor(week),
      month: dispoFor(month),
    };
    const vendorsByWindow = {
      today: vendorsFor(today),
      week: vendorsFor(week),
      month: leadsByVendor,
    };

    // ---- Activity scoring ----
    // Per-agent breakdown over an arbitrary subset of activity rows.
    const activityFor = (arr: ActivityRow[]) => {
      type Agg = {
        score: number;
        actions: number;
        calls: number;
        connectedCalls: number;
        dispoChanges: number;
        quotes: number;
        claims: number;
        notes: number;
        emails: number;
        speedToClaim: SpeedToClaimSummary;
        unclaimed: UnclaimedSummary;
        _quotedLeadIds: Set<string>;
        _claimedLeadIds: Set<string>;
        /** First-time live-lead claim per (lead_id, side) for speed credit. */
        _seenSpeedKey: Set<string>;
      };
      const m = new Map<string, Agg>();
      const initAgg = (): Agg => ({
        score: 0, actions: 0, calls: 0, connectedCalls: 0,
        dispoChanges: 0, quotes: 0, claims: 0, notes: 0, emails: 0,
        speedToClaim: emptySpeedSummary(),
        unclaimed: emptyUnclaimedSummary(),
        _quotedLeadIds: new Set<string>(), _claimedLeadIds: new Set<string>(),
        _seenSpeedKey: new Set<string>(),
      });
      // Process activities oldest-first so the first claim per (lead, side)
      // wins for the speed metric.
      const sortedArr = arr.slice().sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      for (const a of sortedArr) {
        if (!a.user_id) continue;
        const cur = m.get(a.user_id) ?? initAgg();
        cur.score += scoreActivity(a);
        cur.actions += 1;
        if (a.action === "call_logged") {
          cur.calls += 1;
          const outcome = String((a.details as any)?.outcome ?? "");
          if (outcome.startsWith("connected_")) cur.connectedCalls += 1;
        } else if (a.action === "dispo_changed") {
          cur.dispoChanges += 1;
        }
        else if (a.action === "quoted_premium_changed" || a.action === "line_premium_changed") {
          const key = quoteCreditKey(a);
          if (key) cur._quotedLeadIds.add(key);
        }
        else if (a.action === "claimed") {
          if (a.lead_id) cur._claimedLeadIds.add(a.lead_id);
          // Live-lead claims are real conversations — bucket them as
          // connected calls so the leaderboard reflects transfer pickups.
          if (a.lead_table === "leads") {
            cur.calls += 1;
            cur.connectedCalls += 1;
            // Speed-to-claim credit on first claim per (lead, side).
            if (a.lead_id) {
              const d = (a.details ?? {}) as Record<string, unknown>;
              const side = String(d.side ?? "").toLowerCase().trim() || "unknown";
              const speedKey = `${a.lead_id}:${side}`;
              if (!cur._seenSpeedKey.has(speedKey)) {
                cur._seenSpeedKey.add(speedKey);
                const createdAt = leadCreatedById.get(a.lead_id);
                const sec = speedToClaimSeconds(createdAt, a.created_at);
                if (sec != null) {
                  addSpeedSample(cur.speedToClaim, sec);
                  cur.score += speedBonus(sec);
                }
              }
            }
          }
        }
        else if (a.action === "agent_notes_edited") cur.notes += 1;
        else if (a.action === "email_sent") cur.emails += 1;
        m.set(a.user_id, cur);
      }
      // Floor: ensure every known sales/admin agent appears on the
      // leaderboard, even with zero activity in this window.
      for (const aid of allAgentIds) {
        if (!m.has(aid)) m.set(aid, initAgg());
      }
      return Array.from(m.entries())
        .map(([id, v]) => {
          const { _quotedLeadIds, _claimedLeadIds, _seenSpeedKey, ...rest } = v;
          return {
            id,
            name: nameOf(id),
            avatarPath: avatarOf(id),
            ...rest,
            quotes: _quotedLeadIds.size,
            claims: _claimedLeadIds.size,
          };
        })
        .sort((a, b) => b.score - a.score);
    };

    const inWin = (a: ActivityRow, from: number) =>
      new Date(a.created_at).getTime() >= from;
    const actToday = activities.filter((a) => inWin(a, dayStart));
    const actWeek = activities.filter((a) => inWin(a, weekStart));
    const actMonth = activities.filter((a) => inWin(a, monthStart));

    const mergeUnclaimed = <T extends { id: string; unclaimed: UnclaimedSummary }>(
      rows: T[],
      fromMs: number,
    ): T[] => {
      const u = unclaimedFor(fromMs);
      for (const r of rows) {
        const s = u.get(r.id);
        if (s) r.unclaimed = s;
      }
      return rows;
    };

    const activityByWindow = {
      today: mergeUnclaimed(activityFor(actToday), dayStart),
      week: mergeUnclaimed(activityFor(actWeek), weekStart),
      month: mergeUnclaimed(activityFor(actMonth), monthStart),
    };

    // Personal totals for the current sales agent (used in their KPI strip).
    const myActivity = {
      today: activityByWindow.today.find((r) => r.id === userId) ?? null,
      week: activityByWindow.week.find((r) => r.id === userId) ?? null,
      month: activityByWindow.month.find((r) => r.id === userId) ?? null,
    };

    return {
      scope: isAdmin ? "admin" : isVendorRole ? "vendor" : isSales ? "sales" : "vendor",
      currentUserId: userId,
      view: requestedView,
      selectedAgentId: effectiveAgentId,
      agents,
      kpis: {
        leadsToday: today.length,
        leadsWeek: week.length,
        leadsMonth: month.length,
        totalSold: totalPoliciesSold,
        soldToday: soldRowsToday.length,
        totalItems: soldRowsAll.reduce((s, row) => s + (row.items || 0), 0),
        premiumSold,
        premiumSoldToday,
        closeRate,
      },
      kpisByWindow,
      leadsByVendor,
      vendorsByWindow,
      vendorRevenue: {
        total: payoutTotal,
        month: payoutMonth,
        week: payoutWeek,
        today: payoutToday,
        paidLeads,
        unpaidLeads,
      },
      topAgentsDay: topAgents(dayStart),
      topAgentsWeek: topAgents(weekStart),
      topAgentsMonth: topAgents(monthStart),
      trend,
      trendWeek,
      trendMonth,
      dispoBreakdown,
      dispoByWindow,
      activityByWindow,
      myActivity,
      breakdowns: buildBreakdowns({
        leads,
        saleRows,
        // Use the augmented arrays so backfilled rows (extra-line sales whose
        // main dispo isn't 'sold') contribute their first_name/last_name to
        // the lead-name lookup. Otherwise the breakdown falls back to
        // "Lead xxxxxx".
        soldLeads: [...liveSold, ...listSold],
        activities,
        userId,
        dayStart,
        weekStart,
        monthStart,
        vendorRateById,
        vendorNameOf,
        nameOf,
        costOf,
        hideCost,
        autoSold,
        homeSold,
        autoQuoted,
        homeQuoted,
      }),
    };
  });

// ---------- KPI breakdowns (show-your-work payload) ----------

const MAX_BREAKDOWN_ROWS = 60;

type BreakdownRow = {
  id: string;
  primary: string;
  secondary?: string;
  value: string;
  when?: string | null;
};

export type KpiBreakdown = {
  formula: string;
  rows: BreakdownRow[];
  total: string;
  truncated?: number;
};

type WindowedBreakdown = { today: KpiBreakdown; week: KpiBreakdown; month: KpiBreakdown };

export type KpiBreakdowns = {
  leads: WindowedBreakdown;
  policies: WindowedBreakdown;
  items: WindowedBreakdown;
  premium: WindowedBreakdown;
  closeRate: WindowedBreakdown;
  leadCost: WindowedBreakdown;
  activity: WindowedBreakdown;
};

function fmtMoneyShort(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function fmtWhen(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildBreakdowns(args: {
  leads: Lead[];
  saleRows: SaleRow[];
  soldLeads: SoldAnalyticsLead[];
  activities: ActivityRow[];
  userId: string;
  dayStart: number;
  weekStart: number;
  monthStart: number;
  vendorRateById: Map<string, number>;
  vendorNameOf: (id: string | null) => string;
  nameOf: (id: string | null) => string;
  costOf: (l: Lead) => number;
  hideCost: boolean;
  autoSold: (l: Lead) => boolean;
  homeSold: (l: Lead) => boolean;
  autoQuoted: (l: Lead) => boolean;
  homeQuoted: (l: Lead) => boolean;
}): KpiBreakdowns {
  const {
    leads, saleRows, soldLeads, activities, userId,
    dayStart, weekStart, monthStart,
    vendorNameOf, nameOf, costOf, hideCost,
    autoSold, homeSold, autoQuoted, homeQuoted,
  } = args;

  // Lead name lookups
  const leadNameById = new Map<string, string>();
  const fillName = (id: string, fn: string | null | undefined, ln: string | null | undefined) => {
    if (leadNameById.has(id)) return;
    const n = [fn, ln].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
    leadNameById.set(id, n || `Lead ${id.slice(0, 6)}`);
  };
  for (const l of leads) fillName(l.id, l.first_name ?? null, l.last_name ?? null);
  for (const l of soldLeads as unknown as { id: string; first_name?: string | null; last_name?: string | null }[]) {
    fillName(l.id, l.first_name ?? null, l.last_name ?? null);
  }
  const leadName = (id: string) => leadNameById.get(id) ?? `Lead ${id.slice(0, 6)}`;

  const cap = <T,>(rows: T[]): { rows: T[]; truncated?: number } => {
    if (rows.length <= MAX_BREAKDOWN_ROWS) return { rows };
    return { rows: rows.slice(0, MAX_BREAKDOWN_ROWS), truncated: rows.length - MAX_BREAKDOWN_ROWS };
  };

  // ----- Leads -----
  const leadsFor = (from: number): KpiBreakdown => {
    const within = leads
      .filter((l) => new Date(l.created_at).getTime() >= from)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const c = cap(within);
    return {
      formula: "Count of leads created in this window.",
      rows: c.rows.map((l) => ({
        id: l.id,
        primary: leadName(l.id),
        secondary: l.referred_by
          ? `Submitted by ${nameOf(l.referred_by)}`
          : vendorNameOf(l.vendor_id),
        value: "+1",
        when: fmtWhen(l.created_at),
      })),
      total: `${within.length} leads`,
      truncated: c.truncated,
    };
  };

  // ----- Policies (sale rows) -----
  const salesIn = (from: number) =>
    saleRows
      .filter((r) => !!r.occurredAt && new Date(r.occurredAt).getTime() >= from)
      .sort(
        (a, b) =>
          new Date(b.occurredAt ?? 0).getTime() - new Date(a.occurredAt ?? 0).getTime(),
      );

  const policiesFor = (from: number): KpiBreakdown => {
    const rows = salesIn(from);
    const totalItems = rows.reduce((s, r) => s + (r.items || 0), 0);
    const c = cap(rows);
    return {
      formula: "Sum of policy count per sold side (auto + home counted separately).",
      rows: c.rows.map((r, i) => ({
        id: `${r.leadId}-${i}`,
        primary: leadName(r.leadId),
        secondary: `${nameOf(r.ownerId)}`,
        value: `${r.items}`,
        when: fmtWhen(r.occurredAt),
      })),
      total: `${totalItems} policies`,
      truncated: c.truncated,
    };
  };

  // ----- Items sold (sum of items across all sale rows) -----
  const itemsFor = (from: number): KpiBreakdown => {
    const rows = salesIn(from);
    const totalItems = rows.reduce((s, r) => s + (r.items || 0), 0);
    const c = cap(rows);
    return {
      formula:
        "Sum of item counts across all sold sides (e.g. 3 vehicles on one auto sale = 3 items).",
      rows: c.rows.map((r, i) => ({
        id: `${r.leadId}-${i}-${r.side}`,
        primary: leadName(r.leadId),
        secondary: `${nameOf(r.ownerId)} · ${r.side}`,
        value: `${r.items}`,
        when: fmtWhen(r.occurredAt),
      })),
      total: `${totalItems} items`,
      truncated: c.truncated,
    };
  };

  // ----- Premium -----
  const premiumFor = (from: number): KpiBreakdown => {
    const rows = salesIn(from);
    const total = rows.reduce((s, r) => s + (r.premium || 0), 0);
    const c = cap(rows);
    return {
      formula: "Sum of written premium across all sold policies.",
      rows: c.rows.map((r, i) => ({
        id: `${r.leadId}-${i}`,
        primary: leadName(r.leadId),
        secondary: nameOf(r.ownerId),
        value: fmtMoneyShort(r.premium || 0),
        when: fmtWhen(r.occurredAt),
      })),
      total: fmtMoneyShort(total),
      truncated: c.truncated,
    };
  };

  // ----- Close rate -----
  const closeRateFor = (from: number): KpiBreakdown => {
    const arr = leads.filter((l) => new Date(l.created_at).getTime() >= from);
    const soldList = arr.filter((l) => autoSold(l) || homeSold(l));
    const quotedList = arr.filter((l) => autoQuoted(l) || homeQuoted(l));
    const pct = quotedList.length
      ? (soldList.length / quotedList.length) * 100
      : 0;
    return {
      formula: "Close rate = sold leads ÷ quoted leads × 100.",
      rows: [
        { id: "sold", primary: "Sold leads", value: `${soldList.length}` },
        { id: "quoted", primary: "Quoted leads", value: `${quotedList.length}` },
        {
          id: "calc",
          primary: "Calculation",
          value: `${soldList.length} ÷ ${quotedList.length || 0} = ${pct.toFixed(1)}%`,
        },
      ],
      total: `${pct.toFixed(1)}%`,
    };
  };

  // ----- Lead Cost -----
  const leadCostFor = (from: number): KpiBreakdown => {
    if (hideCost) {
      return { formula: "Lead cost is not available for your role.", rows: [], total: fmtMoneyShort(0) };
    }
    const within = leads
      .filter((l) => new Date(l.created_at).getTime() >= from)
      .map((l) => ({ lead: l, cost: costOf(l) }))
      .filter((x) => x.cost > 0)
      .sort((a, b) => b.cost - a.cost);
    const total = within.reduce((s, x) => s + x.cost, 0);
    const c = cap(within);
    return {
      formula: "Sum of per-lead cost (vendor payout, or vendor's default rate as a fallback).",
      rows: c.rows.map((x) => ({
        id: x.lead.id,
        primary: leadName(x.lead.id),
        secondary: vendorNameOf(x.lead.vendor_id),
        value: fmtMoneyShort(x.cost),
        when: fmtWhen(x.lead.created_at),
      })),
      total: fmtMoneyShort(total),
      truncated: c.truncated,
    };
  };

  // ----- Activity Score (current user only) -----
  const activityFor = (from: number): KpiBreakdown => {
    const within = activities
      .filter((a) => a.user_id === userId)
      .filter((a) => new Date(a.created_at).getTime() >= from)
      .map((a) => ({ a, points: scoreActivity(a) }))
      .filter((x) => x.points > 0)
      .sort(
        (a, b) => new Date(b.a.created_at).getTime() - new Date(a.a.created_at).getTime(),
      );
    const total = within.reduce((s, x) => s + x.points, 0);
    const c = cap(within);
    return {
      formula:
        "Each tracked action earns weighted points (connected calls and meaningful dispo changes get a bonus).",
      rows: c.rows.map((x, i) => ({
        id: `${x.a.lead_id ?? "act"}-${i}`,
        primary: x.a.action.replace(/_/g, " "),
        secondary: x.a.lead_id ? `Lead ${x.a.lead_id.slice(0, 6)}` : undefined,
        value: `+${x.points}`,
        when: fmtWhen(x.a.created_at),
      })),
      total: `${total} pts`,
      truncated: c.truncated,
    };
  };

  const win = <T,>(fn: (from: number) => T): { today: T; week: T; month: T } => ({
    today: fn(dayStart),
    week: fn(weekStart),
    month: fn(monthStart),
  });

  return {
    leads: win(leadsFor),
    policies: win(policiesFor),
    items: win(itemsFor),
    premium: win(premiumFor),
    closeRate: win(closeRateFor),
    leadCost: win(leadCostFor),
    activity: win(activityFor),
  };
}