import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type GoalPeriod = "weekly" | "monthly" | "quarterly" | "yearly";
export type GoalMetric = "policies" | "items" | "premium";
export type GoalScope = "agency" | "agent";

export type GoalRow = {
  id: string;
  scope: GoalScope;
  agent_id: string | null;
  period: GoalPeriod;
  metric: GoalMetric;
  target: number;
};

export type GoalProgress = {
  period: GoalPeriod;
  metric: GoalMetric;
  target: number;
  actual: number;
};

function periodRange(period: GoalPeriod, now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  if (period === "weekly") {
    start.setDate(start.getDate() - start.getDay()); // Sunday
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 7);
  } else if (period === "monthly") {
    start.setDate(1);
    end.setTime(start.getTime());
    end.setMonth(end.getMonth() + 1);
  } else if (period === "quarterly") {
    const q = Math.floor(start.getMonth() / 3);
    start.setMonth(q * 3, 1);
    end.setTime(start.getTime());
    end.setMonth(end.getMonth() + 3);
  } else {
    start.setMonth(0, 1);
    end.setTime(start.getTime());
    end.setFullYear(end.getFullYear() + 1);
  }
  return { start, end };
}

type SoldLite = {
  updated_at: string | null;
  dispo: string | null;
  home_dispo: string | null;
  claimed_by: string | null;
  home_claimed_by: string | null;
  quoted_premium: number | null;
  home_quoted_premium: number | null;
  auto_sale_type: string | null;
  home_sale_type: string | null;
  auto_policies_count: number | null;
  home_policies_count: number | null;
  auto_motor_club_premium: number | null;
  num_vehicles: number | null;
  lead_lines: unknown;
};

type LeadLine = {
  type?: string | null;
  dispo?: string | null;
  claimed_by?: string | null;
  quoted_premium?: number | string | null;
  items?: number | string | null;
  sold_at?: string | null;
};

function aggregateSides(leads: SoldLite[], agentId: string | null) {
  let policies = 0;
  let items = 0;
  let premium = 0;
  for (const l of leads) {
    const autoSold = l.dispo === "sold" && l.claimed_by;
    const homeSold = l.home_dispo === "sold" && l.home_claimed_by;
    if (autoSold && (!agentId || l.claimed_by === agentId)) {
      policies += 1;
      items += Math.max(
        1,
        Number(l.num_vehicles ?? l.auto_policies_count ?? 1) || 1,
      );
      premium += Number(l.quoted_premium ?? 0);
      premium += Number(l.auto_motor_club_premium ?? 0);
    }
    if (homeSold && (!agentId || l.home_claimed_by === agentId)) {
      policies += 1;
      items += Math.max(1, Number(l.home_policies_count ?? 1) || 1);
      premium += Number(l.home_quoted_premium ?? 0);
    }
    // Extra sold policies tracked on lead_lines (e.g. flood, umbrella, life).
    const lines = Array.isArray(l.lead_lines) ? (l.lead_lines as LeadLine[]) : [];
    for (const line of lines) {
      if (line?.dispo !== "sold") continue;
      if (agentId && line.claimed_by !== agentId) continue;
      policies += 1;
      const it = Number(line.items ?? 1);
      items += Math.max(1, Number.isFinite(it) ? it : 1);
      premium += Number(line.quoted_premium ?? 0) || 0;
    }
  }
  return { policies, items, premium };
}

async function fetchSoldInRange(start: Date, end: Date): Promise<SoldLite[]> {
  const cols =
    "updated_at, dispo, home_dispo, claimed_by, home_claimed_by, quoted_premium, home_quoted_premium, auto_sale_type, home_sale_type, auto_policies_count, home_policies_count, auto_motor_club_premium, num_vehicles, lead_lines";
  const [live, list] = await Promise.all([
    supabaseAdmin
      .from("leads")
      .select(cols)
      .or("dispo.eq.sold,home_dispo.eq.sold")
      .gte("updated_at", start.toISOString())
      .lt("updated_at", end.toISOString()),
    supabaseAdmin
      .from("list_leads")
      .select(cols)
      .or("dispo.eq.sold,home_dispo.eq.sold")
      .gte("updated_at", start.toISOString())
      .lt("updated_at", end.toISOString()),
  ]);
  if (live.error) throw new Error(live.error.message);
  if (list.error) throw new Error(list.error.message);
  return [
    ...((live.data ?? []) as SoldLite[]),
    ...((list.data ?? []) as SoldLite[]),
  ];
}

const PERIODS: GoalPeriod[] = ["weekly", "monthly", "quarterly", "yearly"];
const METRICS: GoalMetric[] = ["policies", "items", "premium"];

const WEEKLY_AUTO_KEY = "goals_weekly_auto";
const WEEKS_PER_MONTH = 52 / 12; // ≈ 4.3333

function deriveWeeklyTarget(monthly: number) {
  if (!monthly || monthly <= 0) return 0;
  return Math.round(monthly / WEEKS_PER_MONTH);
}

async function readWeeklyAuto(): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", WEEKLY_AUTO_KEY)
    .maybeSingle();
  const v = (data?.value as { auto?: boolean } | null) ?? null;
  // Default: auto on.
  return v?.auto !== false;
}

/** Read whether weekly goals auto-derive from monthly. */
export const getGoalsConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    return { weeklyAuto: await readWeeklyAuto() };
  });

/** Admin-only: toggle weekly auto-derivation. */
export const setGoalsConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ weeklyAuto: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden: admin only");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert(
        { key: WEEKLY_AUTO_KEY, value: { auto: data.weeklyAuto }, updated_by: context.userId },
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);
    return { ok: true, weeklyAuto: data.weeklyAuto };
  });

/** Load all goals (agency + every agent). Anyone signed in can read. */
export const listGoals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("goals")
      .select("id, scope, agent_id, period, metric, target");
    if (error) throw new Error(error.message);
    const weeklyAuto = await readWeeklyAuto();
    return { goals: (data ?? []) as GoalRow[], weeklyAuto };
  });

/** Get progress for the agency or a single agent across all periods/metrics. */
export const getGoalProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        scope: z.enum(["agency", "agent"]).default("agent"),
        agentId: z.string().uuid().nullable().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const targetAgent =
      data.scope === "agency"
        ? null
        : (data.agentId ?? context.userId);

    // Pull goals once.
    const { data: goalsRaw } = await supabaseAdmin
      .from("goals")
      .select("id, scope, agent_id, period, metric, target");
    const goals = (goalsRaw ?? []) as GoalRow[];

    const matching = goals.filter((g) =>
      data.scope === "agency"
        ? g.scope === "agency"
        : g.scope === "agent" && g.agent_id === targetAgent,
    );

    const weeklyAuto = await readWeeklyAuto();

    // Default targets for new agents: 25 policies, $25,000 premium.
    // Agency goals never get defaults.
    const DEFAULT_TARGETS: Record<GoalMetric, number> = {
      policies: 25,
      premium: 25000,
      items: 25,
    };

    // Compute actuals for each period in parallel.
    const totalsByPeriod: Record<GoalPeriod, { policies: number; items: number; premium: number }> = {
      weekly: { policies: 0, items: 0, premium: 0 },
      monthly: { policies: 0, items: 0, premium: 0 },
      quarterly: { policies: 0, items: 0, premium: 0 },
      yearly: { policies: 0, items: 0, premium: 0 },
    };
    await Promise.all(
      PERIODS.map(async (p) => {
        const { start, end } = periodRange(p);
        const leads = await fetchSoldInRange(start, end);
        totalsByPeriod[p] = aggregateSides(leads, targetAgent);
      }),
    );

    const progress: GoalProgress[] = [];
    for (const p of PERIODS) {
      for (const m of METRICS) {
        const g = matching.find((x) => x.period === p && x.metric === m);
        let target: number;
        if (p === "weekly" && weeklyAuto) {
          const monthly = matching.find(
            (x) => x.period === "monthly" && x.metric === m,
          );
          const monthlyTarget =
            data.scope === "agency"
              ? monthly?.target ?? 0
              : monthly?.target ?? DEFAULT_TARGETS[m];
          target = deriveWeeklyTarget(Number(monthlyTarget));
        } else {
          target =
            data.scope === "agency"
              ? g?.target ?? 0
              : g?.target ?? DEFAULT_TARGETS[m];
        }
        if (target <= 0) continue;
        progress.push({
          period: p,
          metric: m,
          target: Number(target),
          actual: totalsByPeriod[p][m],
        });
      }
    }

    return {
      scope: data.scope,
      agentId: targetAgent,
      progress,
    };
  });

/** Admin-only: bulk upsert goals. */
export const upsertGoals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        goals: z
          .array(
            z.object({
              scope: z.enum(["agency", "agent"]),
              agentId: z.string().uuid().nullable(),
              period: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
              metric: z.enum(["policies", "items", "premium"]),
              target: z.number().min(0).max(1_000_000_000),
            }),
          )
          .min(1)
          .max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden: admin only");

    // Process one row at a time to honor partial unique indexes.
    for (const g of data.goals) {
      if (g.scope === "agency" && g.agentId !== null) {
        throw new Error("Agency goals cannot have an agent id");
      }
      if (g.scope === "agent" && !g.agentId) {
        throw new Error("Agent goals require an agent id");
      }

      const filter = supabaseAdmin
        .from("goals")
        .select("id")
        .eq("scope", g.scope)
        .eq("period", g.period)
        .eq("metric", g.metric);
      const { data: existing } = await (g.scope === "agency"
        ? filter.is("agent_id", null)
        : filter.eq("agent_id", g.agentId!)
      ).maybeSingle();

      if (g.target <= 0) {
        if (existing) {
          const { error } = await supabaseAdmin
            .from("goals")
            .delete()
            .eq("id", existing.id);
          if (error) throw new Error(error.message);
        }
        continue;
      }

      if (existing) {
        const { error } = await supabaseAdmin
          .from("goals")
          .update({ target: g.target })
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabaseAdmin.from("goals").insert({
          scope: g.scope,
          agent_id: g.scope === "agent" ? g.agentId : null,
          period: g.period,
          metric: g.metric,
          target: g.target,
        });
        if (error) throw new Error(error.message);
      }
    }
    return { ok: true };
  });

/** Admin-only: list sales agents available for goal-setting. */
export const listSalesAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden: admin only");

    const { data: salesIds, error: rolesErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["sales", "admin"]);
    if (rolesErr) throw new Error(rolesErr.message);
    const ids = Array.from(new Set((salesIds ?? []).map((r) => r.user_id)));
    if (ids.length === 0) return { agents: [] };

    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids);
    if (error) throw new Error(error.message);
    return {
      agents: (profiles ?? [])
        .map((p) => ({
          id: p.id,
          name: p.full_name || p.email || "Unknown",
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });