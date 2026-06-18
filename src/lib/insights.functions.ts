import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type Period = "day" | "week" | "month";

function periodStart(p: Period): Date {
  const d = new Date();
  if (p === "day") d.setHours(0, 0, 0, 0);
  else if (p === "week") {
    d.setDate(d.getDate() - 7);
  } else {
    d.setDate(d.getDate() - 30);
  }
  return d;
}

async function isAdminUser(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  return (data ?? []).some((r) => r.role === "admin");
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

function percentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length));
  return sortedMs[idx];
}

/**
 * Performance insights: telephony + lead lifecycle metrics that the rest of
 * the app stores but never aggregates. Admin sees everyone; agents see self.
 */
export const getPerformanceInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { period: Period }) =>
    z.object({ period: z.enum(["day", "week", "month"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const admin = await isAdminUser(userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = periodStart(data.period);
    const sinceIso = since.toISOString();

    // --- Telephony (call_logs) ---
    let callsQ = supabaseAdmin
      .from("call_logs")
      .select("agent_id, outcome, duration_seconds, answered_at, hangup_cause, started_at")
      .gte("started_at", sinceIso)
      .limit(20000);
    if (!admin) callsQ = callsQ.eq("agent_id", userId);
    const { data: calls } = await callsQ;
    const callRows = calls ?? [];

    let totalCalls = 0;
    let connected = 0;
    let talkSeconds = 0;
    let abandoned = 0;
    const perAgent = new Map<
      string,
      { calls: number; connected: number; talk: number }
    >();
    for (const c of callRows) {
      totalCalls += 1;
      const isConnected =
        !!c.answered_at ||
        String(c.outcome ?? "").startsWith("connected_");
      if (isConnected) connected += 1;
      const dur = Number(c.duration_seconds ?? 0);
      if (isConnected && dur > 0) talkSeconds += dur;
      const hc = String(c.hangup_cause ?? "").toLowerCase();
      if (!isConnected && /busy|no.?answer|cancel|abandon|rejected/.test(hc)) {
        abandoned += 1;
      }
      const aid = c.agent_id ?? "_unknown";
      const a = perAgent.get(aid) ?? { calls: 0, connected: 0, talk: 0 };
      a.calls += 1;
      if (isConnected) a.connected += 1;
      if (isConnected && dur > 0) a.talk += dur;
      perAgent.set(aid, a);
    }

    // --- Speed-to-first-touch ---
    const leadsCols = "id,created_at,claimed_at,home_claimed_at,dispo,home_dispo,updated_at,vendor_id";
    const { data: liveLeads } = await supabaseAdmin
      .from("leads")
      .select(leadsCols)
      .gte("created_at", sinceIso)
      .limit(20000);
    const sttMs: number[] = [];
    for (const l of liveLeads ?? []) {
      const claim = l.claimed_at ?? l.home_claimed_at;
      if (!claim || !l.created_at) continue;
      const diff = new Date(claim).getTime() - new Date(l.created_at).getTime();
      if (diff >= 0 && diff < 1000 * 60 * 60 * 24 * 30) sttMs.push(diff);
    }
    sttMs.sort((a, b) => a - b);
    const avgSttMs =
      sttMs.length > 0 ? sttMs.reduce((s, n) => s + n, 0) / sttMs.length : 0;

    // --- Follow-up SLA (across all open follow_ups, regardless of period) ---
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    let slaQ = supabaseAdmin
      .from("leads")
      .select("id,follow_up_at,claimed_by,updated_at,dispo")
      .not("follow_up_at", "is", null)
      .lt("follow_up_at", new Date().toISOString())
      .gte("follow_up_at", sevenDaysAgo)
      .limit(5000);
    if (!admin) slaQ = slaQ.eq("claimed_by", userId);
    const { data: slaLeads } = await slaQ;
    let slaTotal = 0;
    let slaHit = 0;
    for (const l of slaLeads ?? []) {
      slaTotal += 1;
      const due = l.follow_up_at ? new Date(l.follow_up_at).getTime() : 0;
      const upd = l.updated_at ? new Date(l.updated_at).getTime() : 0;
      // "Hit" = lead was touched within 24h of its follow_up time
      if (upd >= due && upd - due <= 86400 * 1000) slaHit += 1;
    }

    // --- Lead aging by dispo (open quoted/follow-up/x_date leads, stale) ---
    const now = Date.now();
    let agingQ = supabaseAdmin
      .from("leads")
      .select("id,dispo,home_dispo,updated_at,claimed_by,home_claimed_by")
      .or("dispo.in.(quoted,follow_up,x_date),home_dispo.in.(quoted,follow_up,x_date)")
      .limit(5000);
    if (!admin) {
      agingQ = agingQ.or(`claimed_by.eq.${userId},home_claimed_by.eq.${userId}`);
    }
    const { data: agingLeads } = await agingQ;
    const buckets = { gt3: 0, gt7: 0, gt14: 0 };
    for (const l of agingLeads ?? []) {
      const upd = l.updated_at ? new Date(l.updated_at).getTime() : now;
      const days = (now - upd) / 86400000;
      if (days > 14) buckets.gt14 += 1;
      else if (days > 7) buckets.gt7 += 1;
      else if (days > 3) buckets.gt3 += 1;
    }

    // --- Resolve agent names ---
    const agentIds = Array.from(perAgent.keys()).filter((x) => x !== "_unknown");
    const nameById = new Map<string, string>();
    if (agentIds.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id,full_name,email")
        .in("id", agentIds);
      for (const p of profs ?? []) {
        nameById.set(p.id, (p.full_name as string | null) ?? (p.email as string | null) ?? "Unknown");
      }
    }

    const perAgentRows = Array.from(perAgent.entries())
      .map(([id, a]) => ({
        id,
        name: nameById.get(id) ?? "Unknown",
        calls: a.calls,
        connected: a.connected,
        contactRate: pct(a.connected, a.calls),
        talkSeconds: a.talk,
        aht: a.connected > 0 ? Math.round(a.talk / a.connected) : 0,
      }))
      .sort((a, b) => b.calls - a.calls);

    return {
      period: data.period,
      isAdmin: admin,
      telephony: {
        totalCalls,
        connected,
        contactRate: pct(connected, totalCalls),
        talkSeconds,
        ahtSeconds: connected > 0 ? Math.round(talkSeconds / connected) : 0,
        abandoned,
        abandonRate: pct(abandoned, totalCalls),
      },
      lifecycle: {
        avgSpeedToTouchSec: Math.round(avgSttMs / 1000),
        p50SpeedToTouchSec: Math.round(percentile(sttMs, 50) / 1000),
        p90SpeedToTouchSec: Math.round(percentile(sttMs, 90) / 1000),
        sampleCount: sttMs.length,
        slaTotal,
        slaHit,
        slaHitRate: pct(slaHit, slaTotal),
        aging: buckets,
      },
      perAgent: perAgentRows,
    };
  });

/**
 * Vendor quality — last 90 days. Admin only.
 */
export const getVendorQuality = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await isAdminUser(context.userId))) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 90 * 86400 * 1000).toISOString();

    const { data: leads } = await supabaseAdmin
      .from("leads")
      .select("id,vendor_id,vendor_payout,dispo,home_dispo,created_at")
      .gte("created_at", since)
      .limit(50000);

    type Agg = {
      vendor_id: string;
      leads: number;
      sold: number;
      payout: number;
      payoutOnSold: number;
    };
    const map = new Map<string, Agg>();
    for (const l of leads ?? []) {
      const vid = l.vendor_id ?? "_unknown";
      const a = map.get(vid) ?? { vendor_id: vid, leads: 0, sold: 0, payout: 0, payoutOnSold: 0 };
      a.leads += 1;
      a.payout += Number(l.vendor_payout ?? 0);
      const sold = l.dispo === "sold" || l.home_dispo === "sold";
      if (sold) {
        a.sold += 1;
        a.payoutOnSold += Number(l.vendor_payout ?? 0);
      }
      map.set(vid, a);
    }

    const vendorIds = Array.from(map.keys()).filter((x) => x !== "_unknown");
    const nameById = new Map<string, string>();
    if (vendorIds.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id,full_name,company_name,email")
        .in("id", vendorIds);
      for (const p of profs ?? []) {
        nameById.set(
          p.id,
          (p.company_name as string | null) ??
            (p.full_name as string | null) ??
            (p.email as string | null) ??
            "Vendor",
        );
      }
    }

    // Rejections last 90 days
    const { data: rejections } = await supabaseAdmin
      .from("vendor_post_rejections")
      .select("vendor_id, created_at")
      .gte("created_at", since)
      .limit(20000);
    const rejByVendor = new Map<string, number>();
    for (const r of rejections ?? []) {
      const v = (r as any).vendor_id ?? "_unknown";
      rejByVendor.set(v, (rejByVendor.get(v) ?? 0) + 1);
    }

    // Disputes last 90 days
    const { data: disputes } = await supabaseAdmin
      .from("lead_disputes")
      .select("vendor_id, status")
      .gte("created_at", since)
      .limit(20000);
    const dispByVendor = new Map<string, { total: number; approved: number }>();
    for (const d of disputes ?? []) {
      const v = (d as any).vendor_id ?? "_unknown";
      const cur = dispByVendor.get(v) ?? { total: 0, approved: 0 };
      cur.total += 1;
      if ((d as any).status === "approved") cur.approved += 1;
      dispByVendor.set(v, cur);
    }

    const rows = Array.from(map.values())
      .filter((a) => a.vendor_id !== "_unknown")
      .map((a) => {
        const rej = rejByVendor.get(a.vendor_id) ?? 0;
        const disp = dispByVendor.get(a.vendor_id) ?? { total: 0, approved: 0 };
        return {
          vendor_id: a.vendor_id,
          name: nameById.get(a.vendor_id) ?? "Vendor",
          leads: a.leads,
          sold: a.sold,
          sellThrough: pct(a.sold, a.leads),
          costPerSale: a.sold > 0 ? Math.round((a.payout / a.sold) * 100) / 100 : 0,
          spend: Math.round(a.payout * 100) / 100,
          rejections: rej,
          rejectRate: pct(rej, a.leads + rej),
          disputes: disp.total,
          disputeApprovalRate: pct(disp.approved, disp.total),
        };
      })
      .sort((a, b) => b.leads - a.leads);

    return rows;
  });

/**
 * Weighted pipeline forecast. Multiplies open quoted_premium by per-dispo
 * close probability. Admin sees all; agents see their own claimed leads.
 */
export const getPipelineForecast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const admin = await isAdminUser(userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const probs: Record<string, number> = {
      quoted: 0.35,
      follow_up: 0.2,
      x_date: 0.5,
      sold: 1,
    };

    let q = supabaseAdmin
      .from("leads")
      .select(
        "id,dispo,home_dispo,quoted_premium,home_quoted_premium,x_date,home_x_date,claimed_by,home_claimed_by,updated_at",
      )
      .or(
        "dispo.in.(quoted,follow_up,x_date),home_dispo.in.(quoted,follow_up,x_date)",
      )
      .limit(20000);
    if (!admin) {
      q = q.or(`claimed_by.eq.${userId},home_claimed_by.eq.${userId}`);
    }
    const { data: leads } = await q;

    const byDispo: Record<string, { count: number; weighted: number; gross: number }> = {
      quoted: { count: 0, weighted: 0, gross: 0 },
      follow_up: { count: 0, weighted: 0, gross: 0 },
      x_date: { count: 0, weighted: 0, gross: 0 },
    };
    let weighted30 = 0;
    let weighted60 = 0;
    let weighted90 = 0;
    const now = Date.now();

    for (const l of leads ?? []) {
      for (const side of ["auto", "home"] as const) {
        const dispo = side === "auto" ? l.dispo : l.home_dispo;
        const prem = Number(
          (side === "auto" ? l.quoted_premium : l.home_quoted_premium) ?? 0,
        );
        const xDate = side === "auto" ? l.x_date : l.home_x_date;
        if (!dispo || prem <= 0) continue;
        const p = probs[dispo] ?? 0;
        if (!p) continue;
        const w = prem * p;
        const bucket = byDispo[dispo];
        if (bucket) {
          bucket.count += 1;
          bucket.gross += prem;
          bucket.weighted += w;
        }
        // Time bucketing: by x_date when present, else assume current month
        const target = xDate ? new Date(xDate).getTime() : now + 15 * 86400000;
        const days = (target - now) / 86400000;
        if (days <= 30) weighted30 += w;
        if (days <= 60) weighted60 += w;
        if (days <= 90) weighted90 += w;
      }
    }

    const totalWeighted = Object.values(byDispo).reduce((s, b) => s + b.weighted, 0);
    const totalGross = Object.values(byDispo).reduce((s, b) => s + b.gross, 0);

    return {
      isAdmin: admin,
      totals: {
        gross: Math.round(totalGross),
        weighted: Math.round(totalWeighted),
        next30: Math.round(weighted30),
        next60: Math.round(weighted60),
        next90: Math.round(weighted90),
      },
      byDispo: Object.fromEntries(
        Object.entries(byDispo).map(([k, v]) => [
          k,
          {
            count: v.count,
            gross: Math.round(v.gross),
            weighted: Math.round(v.weighted),
            probability: probs[k] ?? 0,
          },
        ]),
      ),
    };
  });