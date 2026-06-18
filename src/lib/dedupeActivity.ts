import { supabase } from "@/integrations/supabase/client";

/**
 * Insert a `call_logged` activity row, but skip it if an identical row
 * (same lead, user, outcome, phone) was inserted within the last
 * `windowSeconds`. Prevents double-fires from double-clicks, React
 * StrictMode re-mounts, or stray event listeners from creating twin rows,
 * while still letting genuine redials (several seconds apart) through.
 */
export async function insertCallLoggedDeduped(row: {
  lead_id: string;
  lead_table: "leads" | "list_leads";
  user_id: string;
  outcome: string;
  phone: string;
  extra?: Record<string, unknown>;
  windowSeconds?: number;
}): Promise<{ skipped: boolean; error: { message: string } | null }> {
  const windowSeconds = row.windowSeconds ?? 5;
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();

  const { data: recent } = await supabase
    .from("lead_activities" as never)
    .select("id,details,created_at")
    .eq("lead_table", row.lead_table)
    .eq("lead_id", row.lead_id)
    .eq("user_id", row.user_id)
    .eq("action", "call_logged")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);

  const dupe = (recent as unknown as Array<{ details: Record<string, unknown> }> | null)?.some(
    (r) =>
      (r.details?.outcome ?? null) === row.outcome &&
      (r.details?.phone ?? null) === row.phone,
  );
  if (dupe) return { skipped: true, error: null };

  const { error } = await supabase.from("lead_activities" as never).insert({
    lead_id: row.lead_id,
    lead_table: row.lead_table,
    user_id: row.user_id,
    action: "call_logged",
    details: { outcome: row.outcome, phone: row.phone, ...(row.extra ?? {}) },
  } as never);
  return { skipped: false, error: error ? { message: error.message } : null };
}