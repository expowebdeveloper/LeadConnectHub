import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OpenCallPrompt = {
  leadId: string;
  leadTable: "leads" | "list_leads";
  phone: string;
  activityId: string;
  createdAt: string;
};

export const getMyOpenCallPrompt = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OpenCallPrompt | null> => {
    const { supabase, userId } = context;
    // Only enforce dispo blocking for calls made after this cutoff.
    // Pre-existing undisposed calls should not block agents.
    const ENFORCEMENT_CUTOFF = "2026-06-15T00:00:00Z";
    const windowStart = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const effectiveStart =
      windowStart > ENFORCEMENT_CUTOFF ? windowStart : ENFORCEMENT_CUTOFF;
    const { data, error } = await supabase
      .from("lead_activities")
      .select("id, lead_id, lead_table, details, created_at")
      .eq("user_id", userId)
      .eq("action", "call_logged")
      .gte("created_at", effectiveStart)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error || !data) return null;

    for (const a of data) {
      const table = a.lead_table as "leads" | "list_leads";
      if (table !== "leads" && table !== "list_leads") continue;
      const { data: lead } = await supabase
        .from(table)
        .select("id, phone, requires_dispo_call_activity_id")
        .eq("id", a.lead_id)
        .maybeSingle();
      if (!lead) continue;
      const r = lead as unknown as {
        id: string;
        phone: string | null;
        requires_dispo_call_activity_id: string | null;
      };
      if (r.requires_dispo_call_activity_id === a.id) {
        const details = (a.details ?? {}) as Record<string, unknown>;
        const phone = (details.phone as string | undefined) ?? r.phone ?? "";
        return {
          leadId: r.id,
          leadTable: table,
          phone,
          activityId: a.id,
          createdAt: a.created_at as string,
        };
      }
    }
    return null;
  });