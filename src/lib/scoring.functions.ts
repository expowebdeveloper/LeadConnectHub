import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type WeightValue = number | string[];
const DEFAULT_WEIGHTS: Record<string, WeightValue> = {
  vehicle_per_unit: 15, vehicle_cap: 150,
  carrier_max: 15, age_max: 10, recency_max: 25,
  contact_max: 10, source_max: 10, engagement_max: 5,
  bundling_max: 15, property_max: 15,
  tier_ivantage_bonus: 40,
  tier_winback_bonus: 18,
  tier_winback_base: 2,
  tier_winback_per_vehicle: 4,
  tier_requote_bonus: 10,
  tier_aged_penalty: 0,
  carrier_pts_cheap: 5,
  carrier_pts_standard: 10,
  carrier_pts_premium: 15,
  carrier_pts_unknown: 8,
  carrier_pts_none: 15,
  carrier_pts_nonstandard: 2,
  carriers_nonstandard: ["The General","Dairyland","Bristol West","National General","Direct Auto","Kemper","UAIC"],
  carriers_cheap: ["Geico","State Farm","Auto-Owners"],
  carriers_standard: ["Nationwide","Progressive","Travelers","Mercury"],
  carriers_premium: ["Allstate","Liberty Mutual","Farmers","USAA","AAA"],
  release_penalty_per: 8,
  release_penalty_cap: 30,
  release_penalty_decay_days: 180,
  no_connect_recover_pct_per_day: 1,
  // Home-specific scoring (independent of vehicle count)
  home_age_max: 25,
  home_value_max: 80,
  home_roof_max: 15,
  home_construction_masonry_pts: 10,
  home_construction_frame_pts: 4,
  home_flood_high_pts: 8,
  home_flood_low_pts: 0,
  home_size_max: 5,
  home_liability_penalty: 5,
};

async function ensureAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  if (!(data ?? []).some((r) => r.role === "admin")) {
    throw new Error("Admin role required");
  }
}

export const getScoringWeights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("scoring_weights")
      .select("weights, updated_at, updated_by")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const w = (data?.weights ?? {}) as Record<string, WeightValue>;
    return {
      weights: { ...DEFAULT_WEIGHTS, ...w },
      defaults: DEFAULT_WEIGHTS,
      updated_at: data?.updated_at ?? null,
      updated_by: data?.updated_by ?? null,
    };
  });

export const updateScoringWeights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { weights: Record<string, WeightValue> }) =>
    z.object({
      weights: z.record(
        z.string(),
        z.union([
          z.number().min(-100).max(100),
          z.array(z.string().min(1).max(64)).max(64),
        ]),
      ),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const merged = { ...DEFAULT_WEIGHTS, ...data.weights };
    const { error } = await supabaseAdmin
      .from("scoring_weights")
      .upsert({ id: 1, weights: merged, updated_at: new Date().toISOString(), updated_by: context.userId });
    if (error) throw new Error(error.message);
    // Trigger backfill (no-op writes refire the score trigger)
    const stamp = new Date().toISOString();
    await supabaseAdmin.from("leads").update({ updated_at: stamp } as never).not("id", "is", null);
    await supabaseAdmin.from("list_leads").update({ updated_at: stamp } as never).not("id", "is", null);
    return { ok: true };
  });

export const getScoreDistribution = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const buckets = [0, 20, 40, 60, 80, 101];
    const labels = ["0-19", "20-39", "40-59", "60-79", "80-100"];
    const out: { bucket: string; live: number; list: number }[] = labels.map((b) => ({ bucket: b, live: 0, list: 0 }));

    const { data: liveRows } = await supabaseAdmin
      .from("leads")
      .select("composite_score")
      .not("composite_score", "is", null);
    const { data: listRows } = await supabaseAdmin
      .from("list_leads")
      .select("composite_score")
      .not("composite_score", "is", null);

    const placeIn = (n: number, key: "live" | "list") => {
      for (let i = 0; i < buckets.length - 1; i++) {
        if (n >= buckets[i] && n < buckets[i + 1]) {
          out[i][key] += 1;
          return;
        }
      }
    };
    for (const r of liveRows ?? []) placeIn(Number(r.composite_score), "live");
    for (const r of listRows ?? []) placeIn(Number(r.composite_score), "list");

    // Tier counts
    const { data: tierLive } = await supabaseAdmin
      .from("leads")
      .select("score_tier")
      .not("score_tier", "is", null);
    const { data: tierList } = await supabaseAdmin
      .from("list_leads")
      .select("score_tier")
      .not("score_tier", "is", null);
    const tierCounts: Record<string, number> = { S: 0, A: 0, B: 0, C: 0 };
    for (const r of [...(tierLive ?? []), ...(tierList ?? [])]) {
      const t = String(r.score_tier ?? "");
      if (t in tierCounts) tierCounts[t] += 1;
    }
    return { buckets: out, tiers: tierCounts };
  });