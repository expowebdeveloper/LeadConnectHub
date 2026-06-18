import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function userRoles(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  return (data ?? []).map((r) => r.role as string);
}

/** Transfer a list lead into the live leads table, crediting the telemarketer. */
export const transferListLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ list_lead_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const roles = await userRoles(userId);
    if (!roles.some((r) => r === "telemarketer" || r === "admin")) {
      throw new Error("Forbidden — telemarketer role required");
    }

    const { data: src, error: srcErr } = await supabaseAdmin
      .from("list_leads")
      .select("*")
      .eq("id", data.list_lead_id)
      .maybeSingle();
    if (srcErr) throw new Error(srcErr.message);
    if (!src) throw new Error("List lead not found");
    if ((src as { transferred_lead_id: string | null }).transferred_lead_id) {
      throw new Error("This lead has already been transferred");
    }

    const r = src as Record<string, unknown>;
    const requiredText = (k: string, fallback = ""): string => {
      const v = r[k];
      return typeof v === "string" && v.length > 0 ? v : fallback;
    };

    const insertPayload: Record<string, unknown> = {
      vendor_id: r.vendor_id,
      first_name: requiredText("first_name", "Unknown"),
      last_name: requiredText("last_name", "Unknown"),
      phone: requiredText("phone"),
      email: r.email ?? null,
      date_of_birth: r.date_of_birth ?? null,
      street: requiredText("street", "Unknown"),
      city: requiredText("city", "Unknown"),
      state: requiredText("state", "NA"),
      zip: requiredText("zip", "00000"),
      county: requiredText("county", "Unknown"),
      current_carrier: r.current_carrier ?? null,
      num_vehicles: r.num_vehicles ?? 0,
      vehicles: r.vehicles ?? [],
      vendor_notes: r.vendor_notes ?? null,
      lead_type: r.lead_type ?? "auto",
      current_home_carrier: r.current_home_carrier ?? null,
      year_built: r.year_built ?? null,
      square_feet: r.square_feet ?? null,
      construction_type: r.construction_type ?? null,
      roof_type: r.roof_type ?? null,
      roof_year: r.roof_year ?? null,
      num_stories: r.num_stories ?? null,
      num_bedrooms: r.num_bedrooms ?? null,
      num_bathrooms: r.num_bathrooms ?? null,
      dwelling_value: r.dwelling_value ?? null,
      has_pool: r.has_pool ?? null,
      has_trampoline: r.has_trampoline ?? null,
      claims_last_5y: r.claims_last_5y ?? null,
      mortgage_company: r.mortgage_company ?? null,
      agent_notes: r.agent_notes ?? null,
      transferred_by: userId,
    };
    if (!insertPayload.phone) throw new Error("Lead has no phone — cannot transfer");

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("leads")
      .insert(insertPayload as never)
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    const newId = (inserted as { id: string }).id;

    const { error: updErr } = await supabaseAdmin
      .from("list_leads")
      .update({
        transferred_at: new Date().toISOString(),
        transferred_by: userId,
        transferred_lead_id: newId,
      } as never)
      .eq("id", data.list_lead_id);
    if (updErr) throw new Error(updErr.message);

    await supabaseAdmin.from("lead_activities").insert({
      lead_id: data.list_lead_id,
      lead_table: "list_leads",
      user_id: userId,
      action: "transferred",
      details: { live_lead_id: newId },
    });
    await supabaseAdmin.from("lead_activities").insert({
      lead_id: newId,
      lead_table: "leads",
      user_id: userId,
      action: "transferred_in",
      details: { source_list_lead_id: data.list_lead_id },
    });

    return { ok: true, live_lead_id: newId };
  });

/** Stats for the current telemarketer (or another, if admin) over a period. */
export const getTelemarketerStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        period: z.enum(["day", "week", "month"]).default("day"),
        target_user_id: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const roles = await userRoles(userId);
    const isAdmin = roles.includes("admin");
    const targetId = data.target_user_id && isAdmin ? data.target_user_id : userId;

    const now = new Date();
    const start = new Date(now);
    if (data.period === "day") start.setHours(0, 0, 0, 0);
    else if (data.period === "week") {
      start.setDate(now.getDate() - now.getDay());
      start.setHours(0, 0, 0, 0);
    } else {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
    }
    const startIso = start.toISOString();

    const [callsRes, transfersRes, soldRes, profileRes] = await Promise.all([
      supabaseAdmin
        .from("call_logs")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", targetId)
        .gte("started_at", startIso),
      supabaseAdmin
        .from("list_leads")
        .select("id", { count: "exact", head: true })
        .eq("transferred_by" as never, targetId)
        .gte("transferred_at" as never, startIso),
      supabaseAdmin
        .from("leads")
        .select("id, quoted_premium", { count: "exact" })
        .eq("transferred_by" as never, targetId)
        .eq("dispo", "sold")
        .gte("created_at", startIso),
      supabaseAdmin
        .from("profiles")
        .select(
          "telemarketer_goal_calls, telemarketer_goal_transfers, telemarketer_goal_period, full_name, email",
        )
        .eq("id", targetId)
        .maybeSingle(),
    ]);

    const soldRows = (soldRes.data ?? []) as { quoted_premium: number | null }[];
    const soldPremium = soldRows.reduce(
      (s, r) => s + (Number(r.quoted_premium) || 0),
      0,
    );

    const profile = (profileRes.data as Record<string, unknown> | null) ?? null;

    return {
      period: data.period,
      target_user_id: targetId,
      calls: callsRes.count ?? 0,
      transfers: transfersRes.count ?? 0,
      sold: soldRes.count ?? 0,
      sold_premium: soldPremium,
      goal_calls: (profile?.telemarketer_goal_calls as number | null) ?? null,
      goal_transfers: (profile?.telemarketer_goal_transfers as number | null) ?? null,
      goal_period: (profile?.telemarketer_goal_period as string | null) ?? null,
      display_name:
        (profile?.full_name as string | null) ??
        (profile?.email as string | null) ??
        "",
    };
  });

/** Admin sets telemarketer goals. */
export const setTelemarketerGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        target_user_id: z.string().uuid(),
        calls: z.number().int().min(0).max(100000).nullable(),
        transfers: z.number().int().min(0).max(100000).nullable(),
        period: z.enum(["day", "week", "month"]).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const roles = await userRoles(context.userId);
    if (!roles.includes("admin")) throw new Error("Forbidden");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        telemarketer_goal_calls: data.calls,
        telemarketer_goal_transfers: data.transfers,
        telemarketer_goal_period: data.period,
      } as never)
      .eq("id", data.target_user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** List telemarketers (admin only) — for goal management and analytics drill-in. */
export const listTelemarketers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const roles = await userRoles(context.userId);
    if (!roles.includes("admin")) throw new Error("Forbidden");
    const { data: r } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "telemarketer");
    const ids = Array.from(new Set((r ?? []).map((x) => x.user_id)));
    if (ids.length === 0) return [];
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, full_name, email, telemarketer_goal_calls, telemarketer_goal_transfers, telemarketer_goal_period",
      )
      .in("id", ids);
    return profiles ?? [];
  });

/**
 * Smart call queue: returns available list_leads ranked so cold callers hit the
 * highest-value, freshest, least-touched leads first.
 *
 * Ranking (lower score = called sooner):
 *  - never-called leads beat any previously-called lead
 *  - fewer prior call attempts beats more
 *  - higher list_type_priority beats lower
 *  - older created_at beats newer (don't let leads rot)
 *  - leads with a phone number beat ones without
 *  - missed_transfer list_type gets a boost (warm-ish)
 */
export const getSmartCallQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        search: z.string().max(120).optional(),
        limit: z.number().int().min(1).max(500).default(150),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const roles = await userRoles(context.userId);
    if (!roles.some((r) => r === "telemarketer" || r === "admin")) {
      throw new Error("Forbidden — telemarketer role required");
    }

    let q = supabaseAdmin
      .from("list_leads")
      .select(
        "id, vendor_id, first_name, last_name, phone, city, state, current_carrier, dispo, agent_notes, follow_up_at, claimed_by, claimed_at, transferred_at, transferred_lead_id, list_type, list_type_priority, created_at, composite_score, score_tier",
      )
      .is("archived_at", null)
      .is("claimed_by", null)
      .is("transferred_lead_id", null)
      .limit(500);

    const s = (data.search ?? "").trim().replace(/[%(),]/g, " ").trim();
    if (s) {
      q = q.or(
        [
          `first_name.ilike.%${s}%`,
          `last_name.ilike.%${s}%`,
          `phone.ilike.%${s}%`,
          `city.ilike.%${s}%`,
          `state.ilike.%${s}%`,
        ].join(","),
      );
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Array<Record<string, unknown>>;
    if (list.length === 0) return [];

    const ids = list.map((r) => r.id as string);
    const { data: acts } = await supabaseAdmin
      .from("lead_activities")
      .select("lead_id, created_at, action")
      .eq("lead_table", "list_leads")
      .eq("action", "call_logged")
      .in("lead_id", ids);
    const callMap = new Map<string, { count: number; last: string | null }>();
    for (const a of (acts ?? []) as Array<{ lead_id: string; created_at: string }>) {
      const cur = callMap.get(a.lead_id) ?? { count: 0, last: null };
      cur.count += 1;
      if (!cur.last || a.created_at > cur.last) cur.last = a.created_at;
      callMap.set(a.lead_id, cur);
    }

    const now = Date.now();
    const ranked = list.map((r) => {
      const c = callMap.get(r.id as string) ?? { count: 0, last: null };
      const hasPhone = typeof r.phone === "string" && (r.phone as string).length > 0;
      const composite = Number(r.composite_score ?? 0);
      // Cooldown: if called recently, push back proportionally (24h decay)
      const hoursSinceLast = c.last
        ? (now - new Date(c.last).getTime()) / (1000 * 60 * 60)
        : Infinity;
      const cooldown = c.last ? Math.max(0, 24 - hoursSinceLast) : 0;
      // Lower is better. Composite score is the dominant signal; never-called
      // wins ties; recently-called sinks; missing phones go to the bottom.
      const score =
        c.count * 500 +
        cooldown * 25 +
        (hasPhone ? 0 : 1000) -
        composite * 10;
      return {
        ...r,
        call_count: c.count,
        last_called_at: c.last,
        _score: score,
      };
    });
    ranked.sort((a, b) => (a._score as number) - (b._score as number));
    return ranked.slice(0, data.limit).map(({ _score: _s, ...rest }) => rest);
  });