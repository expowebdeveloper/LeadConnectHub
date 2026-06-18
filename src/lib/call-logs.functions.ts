import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  return (data ?? []).some((r) => r.role === "admin");
}

/**
 * Recent call_logs for "me", a specific lead, or (admin) any agent.
 * Returns enough fields to render a compact call-history list.
 */
export const getRecentCallLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    scope: "me" | "lead" | "agent";
    leadId?: string | null;
    leadTable?: "leads" | "list_leads" | null;
    agentId?: string | null;
    limit?: number;
    sinceIso?: string | null;
  }) =>
    z
      .object({
        scope: z.enum(["me", "lead", "agent"]),
        leadId: z.string().uuid().nullable().optional(),
        leadTable: z.enum(["leads", "list_leads"]).nullable().optional(),
        agentId: z.string().uuid().nullable().optional(),
        limit: z.number().int().min(1).max(200).default(25),
        sinceIso: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const admin = await isAdmin(userId);
    let q = supabaseAdmin
      .from("call_logs")
      .select(
        "id, agent_id, lead_id, lead_table, direction, from_number, to_number, status, outcome, started_at, answered_at, ended_at, duration_seconds, hangup_cause, recording_url",
      )
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(data.limit);

    if (data.scope === "me") {
      q = q.eq("agent_id", userId);
    } else if (data.scope === "lead") {
      if (!data.leadId || !data.leadTable) throw new Error("leadId + leadTable required");
      q = q.eq("lead_id", data.leadId).eq("lead_table", data.leadTable);
      if (!admin) q = q.eq("agent_id", userId);
    } else if (data.scope === "agent") {
      if (!admin) throw new Error("Forbidden");
      if (!data.agentId) throw new Error("agentId required");
      q = q.eq("agent_id", data.agentId);
    }
    if (data.sinceIso) q = q.gte("started_at", data.sinceIso);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const agentIds = Array.from(new Set((rows ?? []).map((r) => r.agent_id).filter(Boolean))) as string[];
    const nameById = new Map<string, string>();
    if (agentIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", agentIds);
      for (const p of profiles ?? []) {
        nameById.set(p.id, (p.full_name as string | null) ?? (p.email as string | null) ?? "");
      }
    }
    return (rows ?? []).map((r) => ({
      ...r,
      agent_name: r.agent_id ? nameById.get(r.agent_id) ?? null : null,
    }));
  });