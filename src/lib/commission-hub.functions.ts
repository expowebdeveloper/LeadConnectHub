import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  calcCommission,
  type AgentType,
  type PolicyLike,
  mergeCommissionConfig,
  type CommissionConfig,
} from "./commissions";

/**
 * Synthesize policy-like rows from sold leads.
 * Assumptions (surfaced to the user via a warning banner):
 *  - Every sold side counts as 1 item.
 *  - Carrier is treated as "Allstate" (this is an Allstate-aligned agency
 *    and we don't yet record the sold-to carrier on a lead).
 *  - When the same lead has both auto and home sold by the SAME agent,
 *    those two rows are tagged "Bundled" for the Homie Allstate bonus.
 *  - written_at is taken from `updated_at` (the closest signal we have to
 *    when dispo moved to "sold").
 */

type SoldRow = {
  ownerId: string;
  written_at: string | null;
  month: string | null;
  policy: PolicyLike;
  leadId: string;
  side: "auto" | "home";
};

type LeadRow = {
  id: string;
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
};

const monthKey = (iso: string | null) => (iso ? iso.slice(0, 7) : null);

function toSoldRows(leads: LeadRow[]): SoldRow[] {
  const out: SoldRow[] = [];
  for (const l of leads) {
    const autoSold = l.dispo === "sold" && l.claimed_by;
    const homeSold = l.home_dispo === "sold" && l.home_claimed_by;
    const sameAgentBundle =
      autoSold && homeSold && l.claimed_by === l.home_claimed_by;
    const writtenAt = l.updated_at;
    const autoReason =
      l.auto_sale_type === "bundled_preferred"
        ? "Bundled (Preferred)"
        : l.auto_sale_type === "bundled" || sameAgentBundle
          ? "Bundled"
          : "Monoline";
    const homeReason =
      l.home_sale_type === "bundled_preferred"
        ? "Bundled (Preferred)"
        : l.home_sale_type === "bundled" || sameAgentBundle
          ? "Bundled"
          : "Monoline";
    if (autoSold) {
      out.push({
        ownerId: l.claimed_by!,
        leadId: l.id,
        side: "auto",
        written_at: writtenAt,
        month: monthKey(writtenAt),
        policy: {
          carrier: "Allstate",
          product: "Auto",
          premium: Number(l.quoted_premium ?? 0) + Number(l.auto_motor_club_premium ?? 0),
          items: Math.max(1, Number(l.auto_policies_count ?? 1) || 1),
          reason: autoReason,
        },
      });
    }
    if (homeSold) {
      out.push({
        ownerId: l.home_claimed_by!,
        leadId: l.id,
        side: "home",
        written_at: writtenAt,
        month: monthKey(writtenAt),
        policy: {
          carrier: "Allstate",
          product: "Home",
          premium: Number(l.home_quoted_premium ?? 0),
          items: Math.max(1, Number(l.home_policies_count ?? 1) || 1),
          reason: homeReason,
        },
      });
    }
  }
  return out;
}

async function fetchSoldLeads(): Promise<LeadRow[]> {
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select(
      "id, updated_at, dispo, home_dispo, claimed_by, home_claimed_by, quoted_premium, home_quoted_premium, auto_sale_type, home_sale_type, auto_policies_count, home_policies_count, auto_motor_club_premium",
    )
    .or("dispo.eq.sold,home_dispo.eq.sold");
  if (error) throw new Error(error.message);
  return (data ?? []) as LeadRow[];
}

async function fetchCommissionConfig(): Promise<CommissionConfig> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .is("workspace_id", null)
    .eq("key", "commissions")
    .maybeSingle();
  return mergeCommissionConfig(
    (data?.value ?? null) as Partial<CommissionConfig> | null,
  );
}

const monthSchema = z
  .object({ month: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional() })
  .optional();

export const getMyCommissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => monthSchema.parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const monthFilter = data?.month ?? null;

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, agent_type")
      .eq("id", userId)
      .maybeSingle();

    const leads = await fetchSoldLeads();
    const rows = toSoldRows(leads).filter((r) => r.ownerId === userId);

    const availableMonths = Array.from(
      new Set(rows.map((r) => r.month).filter(Boolean) as string[]),
    ).sort((a, b) => b.localeCompare(a));

    const filtered = monthFilter ? rows.filter((r) => r.month === monthFilter) : rows;
    const cfg = await fetchCommissionConfig();
    const summary = profile?.agent_type
      ? calcCommission(
          profile.agent_type as AgentType,
          filtered.map((r) => r.policy),
          cfg,
        )
      : null;

    return {
      profile,
      summary,
      rows: filtered.sort((a, b) =>
        (b.written_at ?? "").localeCompare(a.written_at ?? ""),
      ),
      availableMonths,
      selectedMonth: monthFilter,
    };
  });

export const getCommissionsOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => monthSchema.parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const monthFilter = data?.month ?? null;

    const { data: isAdminData } = await context.supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdminData) throw new Error("Forbidden: admin only");

    const [{ data: profiles }, leads, cfg] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, agent_type, avatar_url"),
      fetchSoldLeads(),
      fetchCommissionConfig(),
    ]);

    const rows = toSoldRows(leads);
    const availableMonths = Array.from(
      new Set(rows.map((r) => r.month).filter(Boolean) as string[]),
    ).sort((a, b) => b.localeCompare(a));

    const filteredRows = monthFilter
      ? rows.filter((r) => r.month === monthFilter)
      : rows;

    const byAgent = new Map<string, PolicyLike[]>();
    for (const r of filteredRows) {
      if (!byAgent.has(r.ownerId)) byAgent.set(r.ownerId, []);
      byAgent.get(r.ownerId)!.push(r.policy);
    }

    const profilesById = new Map((profiles ?? []).map((p) => [p.id, p]));

    const agents = (profiles ?? [])
      .filter((p) => p.agent_type)
      .map((p) => {
        const pols = byAgent.get(p.id) ?? [];
        const summary = calcCommission(p.agent_type as AgentType, pols, cfg);
        return {
          userId: p.id,
          displayName: p.full_name || p.email || "Unknown",
          email: p.email,
          avatarPath: (p as { avatar_url: string | null }).avatar_url ?? null,
          agentType: p.agent_type as AgentType,
          policyCount: pols.length,
          totalPremium: pols.reduce((s, x) => s + x.premium, 0),
          commission: summary.commission,
          summary,
        };
      })
      .sort((a, b) => b.commission - a.commission);

    const unassigned: { userId: string; displayName: string; avatarPath: string | null; policyCount: number; totalPremium: number }[] = [];
    for (const [ownerId, pols] of byAgent.entries()) {
      const p = profilesById.get(ownerId);
      if (!p || !p.agent_type) {
        unassigned.push({
          userId: ownerId,
          displayName: p?.full_name || p?.email || "Unknown agent",
          avatarPath: (p as { avatar_url?: string | null } | undefined)?.avatar_url ?? null,
          policyCount: pols.length,
          totalPremium: pols.reduce((s, x) => s + x.premium, 0),
        });
      }
    }
    unassigned.sort((a, b) => b.totalPremium - a.totalPremium);

    return {
      agents,
      unassigned,
      availableMonths,
      selectedMonth: monthFilter,
      totals: {
        agentCount: agents.length,
        totalCommission: agents.reduce((s, a) => s + a.commission, 0),
        totalPremium: filteredRows.reduce((s, r) => s + r.policy.premium, 0),
        policyCount: filteredRows.length,
      },
    };
  });

export const setAgentType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        userId: z.string().uuid(),
        agentType: z.enum(["homie", "autobot", "service"]).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdminData } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdminData) throw new Error("Forbidden: admin only");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ agent_type: data.agentType })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });