import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CACHE_DAYS = 30;

type ParsedPatch = Partial<{
  dwelling_value: number;
  year_built: number;
  square_feet: number;
  roof_year: number;
  construction_type: string;
  has_pool: boolean;
  num_bedrooms: number;
  num_bathrooms: number;
}>;

function buildPatch(parsed: any): ParsedPatch {
  const patch: ParsedPatch = {};
  if (parsed.zestimate != null) patch.dwelling_value = parsed.zestimate;
  if (parsed.year_built != null) patch.year_built = parsed.year_built;
  if (parsed.sqft != null) patch.square_feet = parsed.sqft;
  if (parsed.roof_year != null) patch.roof_year = parsed.roof_year;
  if (parsed.construction_type != null) patch.construction_type = parsed.construction_type;
  if (parsed.has_pool != null) patch.has_pool = parsed.has_pool;
  if (parsed.beds != null) patch.num_bedrooms = parsed.beds;
  if (parsed.baths != null) patch.num_bathrooms = parsed.baths;
  return patch;
}

export const getZillowForLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ leadId: z.string().uuid(), force: z.boolean().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { leadId, force } = data;

    let source: "leads" | "list_leads" = "leads";
    const leadRead = await supabase
      .from("leads")
      .select("id,street,city,state,zip")
      .eq("id", leadId)
      .maybeSingle();
    if (leadRead.error) throw new Error(leadRead.error.message);
    let lead = leadRead.data as { id: string; street: string | null; city: string | null; state: string | null; zip: string | null } | null;
    if (!lead) {
      const listRead = await supabase
        .from("list_leads")
        .select("id,street,city,state,zip")
        .eq("id", leadId)
        .maybeSingle();
      if (listRead.error) throw new Error(listRead.error.message);
      lead = listRead.data;
      source = "list_leads";
    }
    if (!lead) {
      return { source: "no-address" as const, data: null, error: null as string | null };
    }

    const cached = await supabase
      .from("zillow_property_data")
      .select("*")
      .eq("lead_id", leadId)
      .eq("source", source)
      .maybeSingle();

    if (!force && cached.data && !cached.data.fetch_error) {
      const ageMs = Date.now() - new Date(cached.data.fetched_at).getTime();
      if (ageMs < CACHE_DAYS * 24 * 60 * 60 * 1000) {
        return { source: "cache" as const, data: cached.data, error: null as string | null };
      }
    }

    const { fetchZillowProperty, normalizeAddressKey, buildAddressString } = await import("./zillow.server");
    const address = buildAddressString(lead);
    if (!address || !lead.street) {
      return { source: "no-address" as const, data: cached.data ?? null, error: null as string | null };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    try {
      const { raw, parsed } = await fetchZillowProperty(address);
      const row = {
        lead_id: leadId,
        source,
        address_key: normalizeAddressKey(lead),
        ...parsed,
        raw,
        fetch_error: null,
        fetched_at: new Date().toISOString(),
      };
      const up = await supabaseAdmin
        .from("zillow_property_data")
        .upsert(row, { onConflict: "source,lead_id" })
        .select("*")
        .single();
      if (up.error) throw new Error(up.error.message);

      const patch = buildPatch(parsed);
      if (Object.keys(patch).length) {
        await supabaseAdmin.from(source).update(patch).eq("id", leadId);
      }

      return { source: "fetched" as const, data: up.data, error: null as string | null };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await supabaseAdmin
        .from("zillow_property_data")
        .upsert(
          {
            lead_id: leadId,
            source,
            address_key: normalizeAddressKey(lead),
            raw: null,
            fetch_error: message,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "source,lead_id" },
        );
      return { source: "error" as const, data: cached.data ?? null, error: message };
    }
  });

async function ensureAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  if (!(data ?? []).some((r) => r.role === "admin")) {
    throw new Error("Admin role required");
  }
}

export const backfillZillowForListLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ limit: z.number().int().min(1).max(100).default(25) }).parse(input))
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const { runZillowListLeadBackfill } = await import("./zillow.server");
    return runZillowListLeadBackfill(data.limit);
  });