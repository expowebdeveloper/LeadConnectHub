import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { quoteCreditKey } from "@/lib/quote-credit";
import {
  addSpeedSample,
  emptySpeedSummary,
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

type Period = "today" | "week" | "month";

function isValidTz(tz: string | undefined | null): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

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
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

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
  const offset = asUtc - utcGuess;
  return new Date(utcGuess - offset);
}

function startOfDay(d: Date, tz: string): Date {
  const w = wallPartsInTz(d, tz);
  return zonedWallToUtc(w.year, w.month, w.day, 0, 0, tz);
}
function startOfWeek(d: Date, tz: string): Date {
  const localMidnight = startOfDay(d, tz);
  const weekdayName = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(localMidnight);
  const dowMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dow = dowMap[weekdayName] ?? 0;
  const back = new Date(localMidnight.getTime() - dow * 24 * 3600 * 1000);
  const bw = wallPartsInTz(back, tz);
  return zonedWallToUtc(bw.year, bw.month, bw.day, 0, 0, tz);
}
function startOfMonth(d: Date, tz: string): Date {
  const w = wallPartsInTz(d, tz);
  return zonedWallToUtc(w.year, w.month, 1, 0, 0, tz);
}

function rangeFor(p: Period, tzInput?: string | null) {
  const tz = isValidTz(tzInput) ? tzInput : "UTC";
  const now = new Date();
  const start =
    p === "today" ? startOfDay(now, tz)
    : p === "week" ? startOfWeek(now, tz)
    : startOfMonth(now, tz);
  // Compute end via the wall clock so DST transitions stay correct.
  const sw = wallPartsInTz(start, tz);
  let end: Date;
  if (p === "today") {
    end = zonedWallToUtc(sw.year, sw.month, sw.day + 1, 0, 0, tz);
  } else if (p === "week") {
    end = zonedWallToUtc(sw.year, sw.month, sw.day + 7, 0, 0, tz);
  } else {
    end = zonedWallToUtc(sw.year, sw.month + 1, 1, 0, 0, tz);
  }
  return { start, end };
}

export type AgentTally = {
  id: string;
  name: string;
  avatarPath: string | null;
  leads: number;
  quotes: number;
  followUps: number;
  xDates: number;
  speedToClaim: SpeedToClaimSummary;
  unclaimed: UnclaimedSummary;
};

export type HubStats = {
  me: AgentTally;
  team: AgentTally[]; // sorted by leads desc
  ranks: {
    leads: number | null;
    quotes: number | null;
    followUps: number | null;
    xDates: number | null;
    speed: number | null;
    unclaimed: number | null;
    total: number;
  };
  teamUnclaimedRate: number;
  trackingSince: string | null;
};

export const getHubStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { period: Period; tz?: string | null }) => input)
  .handler(async ({ data, context }): Promise<HubStats> => {
    const { userId } = context;
    const { start, end } = rangeFor(data.period, data.tz);
    const startISO = start.toISOString();
    const endISO = end.toISOString();
    const startDate = startISO.slice(0, 10);
    const endDate = endISO.slice(0, 10);

    // All sales agents (anyone who's claimed/owned a lead in the last 90d).
    // We bound by activity rather than enumerating roles to keep the leaderboard relevant.
    const since = new Date();
    since.setDate(since.getDate() - 90);

    const [leadsRes, quoteActivityRes, followRes, xRes] = await Promise.all([
      // Claims within window — track by claimed_at
      supabaseAdmin
        .from("leads")
        .select("claimed_by, home_claimed_by")
        .or(`claimed_by.not.is.null,home_claimed_by.not.is.null`)
        .gte("claimed_at", startISO)
        .lt("claimed_at", endISO),
      // Quotes — first-time premium activity (auto/home/extra lines).
      // Same source of truth as the per-agent leaderboard so totals can't drift.
      supabaseAdmin
        .from("lead_activities")
        .select("user_id, action, lead_id, lead_table, details, created_at")
        .in("action", ["quoted_premium_changed", "line_premium_changed"])
        .gte("created_at", startISO)
        .lt("created_at", endISO),
      // Follow-ups scheduled within window
      supabaseAdmin
        .from("leads")
        .select("agent_id, claimed_by, home_claimed_by, dispo, home_dispo, follow_up_at, home_follow_up_at")
        .or(
          `and(dispo.eq.follow_up,follow_up_at.gte.${startISO},follow_up_at.lt.${endISO}),and(home_dispo.eq.follow_up,home_follow_up_at.gte.${startISO},home_follow_up_at.lt.${endISO})`,
        ),
      // X-dates within window
      supabaseAdmin
        .from("leads")
        .select("agent_id, claimed_by, home_claimed_by, x_date, home_x_date")
        .or(
          `and(x_date.gte.${startDate},x_date.lt.${endDate}),and(home_x_date.gte.${startDate},home_x_date.lt.${endDate})`,
        ),
    ]);

    // Speed-to-claim: every live lead whose auto or home side was claimed
    // inside the window. Both sides are measured independently from the
    // lead's created_at.
    const { data: speedRows } = await supabaseAdmin
      .from("leads")
      .select("created_at, claimed_by, claimed_at, home_claimed_by, home_claimed_at")
      .or(
        `and(claimed_at.gte.${startISO},claimed_at.lt.${endISO}),and(home_claimed_at.gte.${startISO},home_claimed_at.lt.${endISO})`,
      );

    const tallies = new Map<string, AgentTally>();
    const ensure = (id: string): AgentTally => {
      const existing = tallies.get(id);
      if (existing) return existing;
      const t: AgentTally = {
        id,
        name: "",
        avatarPath: null,
        leads: 0,
        quotes: 0,
        followUps: 0,
        xDates: 0,
        speedToClaim: emptySpeedSummary(),
        unclaimed: emptyUnclaimedSummary(),
      };
      tallies.set(id, t);
      return t;
    };

    for (const r of leadsRes.data ?? []) {
      if (r.claimed_by) ensure(r.claimed_by).leads += 1;
      if (r.home_claimed_by && r.home_claimed_by !== r.claimed_by) {
        ensure(r.home_claimed_by).leads += 1;
      }
    }
    // Dedupe first-time premium activity per agent so repeat edits to the
    // same side / extra-line never inflate the count.
    const quoteKeysByAgent = new Map<string, Set<string>>();
    for (const r of quoteActivityRes.data ?? []) {
      const row = r as {
        user_id: string | null;
        action: string;
        lead_id: string | null;
        lead_table: string | null;
        details: Record<string, unknown> | null;
      };
      if (!row.user_id) continue;
      const key = quoteCreditKey({
        action: row.action,
        lead_id: row.lead_id,
        lead_table: row.lead_table,
        details: row.details,
      });
      if (!key) continue;
      let set = quoteKeysByAgent.get(row.user_id);
      if (!set) {
        set = new Set<string>();
        quoteKeysByAgent.set(row.user_id, set);
      }
      set.add(key);
    }
    for (const [agentId, keys] of quoteKeysByAgent) {
      ensure(agentId).quotes = keys.size;
    }
    const ownerAuto = (r: { agent_id?: string | null; claimed_by?: string | null }) =>
      r.claimed_by ?? r.agent_id ?? null;
    const ownerHome = (r: { agent_id?: string | null; home_claimed_by?: string | null }) =>
      r.home_claimed_by ?? r.agent_id ?? null;
    for (const r of followRes.data ?? []) {
      const row = r as {
        agent_id: string | null;
        claimed_by: string | null;
        home_claimed_by: string | null;
        dispo: string | null;
        home_dispo: string | null;
        follow_up_at: string | null;
        home_follow_up_at: string | null;
      };
      if (row.dispo === "follow_up" && row.follow_up_at && row.follow_up_at >= startISO && row.follow_up_at < endISO) {
        const o = ownerAuto(row);
        if (o) ensure(o).followUps += 1;
      }
      if (row.home_dispo === "follow_up" && row.home_follow_up_at && row.home_follow_up_at >= startISO && row.home_follow_up_at < endISO) {
        const o = ownerHome(row);
        if (o) ensure(o).followUps += 1;
      }
    }
    for (const r of xRes.data ?? []) {
      const row = r as {
        agent_id: string | null;
        claimed_by: string | null;
        home_claimed_by: string | null;
        x_date: string | null;
        home_x_date: string | null;
      };
      if (row.x_date && row.x_date >= startDate && row.x_date < endDate) {
        const o = ownerAuto(row);
        if (o) ensure(o).xDates += 1;
      }
      if (row.home_x_date && row.home_x_date >= startDate && row.home_x_date < endDate) {
        const o = ownerHome(row);
        if (o) ensure(o).xDates += 1;
      }
    }

    for (const r of speedRows ?? []) {
      const row = r as {
        created_at: string | null;
        claimed_by: string | null;
        claimed_at: string | null;
        home_claimed_by: string | null;
        home_claimed_at: string | null;
      };
      if (row.claimed_by && row.claimed_at && row.claimed_at >= startISO && row.claimed_at < endISO) {
        const sec = speedToClaimSeconds(row.created_at, row.claimed_at);
        if (sec != null) addSpeedSample(ensure(row.claimed_by).speedToClaim, sec);
      }
      if (row.home_claimed_by && row.home_claimed_at && row.home_claimed_at >= startISO && row.home_claimed_at < endISO) {
        const sec = speedToClaimSeconds(row.created_at, row.home_claimed_at);
        if (sec != null) addSpeedSample(ensure(row.home_claimed_by).speedToClaim, sec);
      }
    }

    // ---- Unclaimed rate ----
    // Load every live lead whose created_at falls in the window (denominator
    // is per-pop, not per-claim), plus presence history + active call
    // intervals covering that span so we can resolve eligible agents at
    // each pop time.
    const [popLeadsRes, presenceRes, callsRes, salesAgentsRes] = await Promise.all([
      supabaseAdmin
        .from("leads")
        .select("id, created_at, claimed_at, home_claimed_at")
        .gte("created_at", startISO)
        .lt("created_at", endISO),
      // Pull presence events from a bit before the window so we always know
      // each user's status at the window's first pop.
      supabaseAdmin
        .from("presence_events")
        .select("user_id, status, started_at")
        .gte("started_at", new Date(start.getTime() - 7 * 24 * 3600 * 1000).toISOString())
        .lt("started_at", endISO),
      Promise.resolve({ data: [] as Array<{ user_id: string | null; started_at: string | null; ended_at: string | null }> }),
      supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .in("role", ["sales", "admin"]),
    ]);

    const popLeads = (popLeadsRes.data ?? []) as Array<{
      id: string;
      created_at: string;
      claimed_at: string | null;
      home_claimed_at: string | null;
    }>;
    const presenceEvents = (presenceRes.data ?? []) as PresenceEvent[];
    const callIntervals = ((callsRes.data ?? []) as Array<{
      user_id: string | null; started_at: string | null; ended_at: string | null;
    }>)
      .filter((c): c is CallInterval => !!c.user_id && !!c.started_at)
      .map((c) => ({ user_id: c.user_id, started_at: c.started_at, ended_at: c.ended_at }));
    const salesAgentIds = Array.from(
      new Set(((salesAgentsRes.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)),
    );

    const idx = buildEligibilityIndex(presenceEvents, callIntervals);

    // Team-wide rate: unclaimed leads / total live leads.
    let teamMissed = 0;
    for (const l of popLeads) if (leadIsUnclaimed(l)) teamMissed += 1;
    const teamUnclaimedRate = popLeads.length > 0 ? teamMissed / popLeads.length : 0;

    // Per-agent: count every pop where the agent was eligible.
    for (const l of popLeads) {
      const popTs = new Date(l.created_at).getTime();
      if (!Number.isFinite(popTs)) continue;
      // Only attribute if we have presence tracking covering this pop.
      if (idx.trackingSince != null && popTs < idx.trackingSince) continue;
      const missed = leadIsUnclaimed(l);
      for (const agentId of salesAgentIds) {
        if (!wasEligibleAt(agentId, popTs, idx)) continue;
        bumpUnclaimed(ensure(agentId).unclaimed, missed);
      }
    }

    // Always include the current user even if zero, so rank still resolves.
    ensure(userId);

    const ids = Array.from(tallies.keys());
    if (ids.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, avatar_url")
        .in("id", ids);
      for (const p of profs ?? []) {
        const t = tallies.get(p.id);
        if (t) {
          t.name = p.full_name || p.email || "Unknown";
          t.avatarPath = (p as { avatar_url: string | null }).avatar_url ?? null;
        }
      }
    }

    const team = Array.from(tallies.values()).sort((a, b) => b.leads - a.leads);
    const me = tallies.get(userId)!;

    const rankFor = (key: keyof Pick<AgentTally, "leads" | "quotes" | "followUps" | "xDates">) => {
      const myVal = me[key];
      if (myVal === 0 && !team.some((t) => t[key] > 0)) return null;
      const sorted = [...team].sort((a, b) => b[key] - a[key]);
      return sorted.findIndex((t) => t.id === userId) + 1 || null;
    };

    // Speed rank: lower avgSec wins; agents with no samples are unranked.
    const speedRank = (): number | null => {
      if (me.speedToClaim.samples === 0) return null;
      const eligible = team.filter((t) => t.speedToClaim.samples > 0);
      if (eligible.length === 0) return null;
      const sorted = [...eligible].sort(
        (a, b) => (a.speedToClaim.avgSec ?? Infinity) - (b.speedToClaim.avgSec ?? Infinity),
      );
      const idx = sorted.findIndex((t) => t.id === userId);
      return idx >= 0 ? idx + 1 : null;
    };

    // Unclaimed rank: lower rate wins; agents with zero eligible events are
    // unranked.
    const unclaimedRank = (): number | null => {
      if (me.unclaimed.eligibleEvents === 0) return null;
      const eligible = team.filter((t) => t.unclaimed.eligibleEvents > 0);
      if (eligible.length === 0) return null;
      const sorted = [...eligible].sort((a, b) => a.unclaimed.rate - b.unclaimed.rate);
      const i = sorted.findIndex((t) => t.id === userId);
      return i >= 0 ? i + 1 : null;
    };

    return {
      me,
      team,
      ranks: {
        leads: rankFor("leads"),
        quotes: rankFor("quotes"),
        followUps: rankFor("followUps"),
        xDates: rankFor("xDates"),
        speed: speedRank(),
        unclaimed: unclaimedRank(),
        total: team.length,
      },
      teamUnclaimedRate,
      trackingSince: idx.trackingSince != null ? new Date(idx.trackingSince).toISOString() : null,
    };
  });