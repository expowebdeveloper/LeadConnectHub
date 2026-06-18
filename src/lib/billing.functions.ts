import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BillingLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  date_of_birth: string | null;
  num_vehicles: number | null;
  dispo: string | null;
  quoted_premium: number | null;
  vendor_payout: number | null;
  vendor_id: string;
  agent_notes: string | null;
  claimed_by: string | null;
  created_at: string;
  source: "live" | "list";
  list_type?: string | null;
  not_billable?: boolean;
  billable_override?: boolean | null;
  current_carrier?: string | null;
  current_home_carrier?: string | null;
};

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: meRoles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const isAdmin = (meRoles ?? []).some((r) => r.role === "admin");
  if (!isAdmin) throw new Error("Forbidden");
}

function isOneCarVendorName(name: string | null | undefined): boolean {
  const n = (name ?? "").toLowerCase();
  return n.includes("nadir") || n.includes("giga") || n.includes("sm connect");
}

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

/** Authenticated: compute billability for a single lead. Used to render the
 * "Not Billable" badge in the lead detail header. */
export const getLeadBillability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        lead_id: z.string().uuid(),
        source: z.enum(["leads", "list_leads"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cols =
      "id, vendor_id, dispo, claimed_by, num_vehicles, date_of_birth, billable_override, current_carrier, current_home_carrier" +
      (data.source === "list_leads" ? ", not_billable" : "");
    const { data: lead, error } =
      data.source === "leads"
        ? await supabaseAdmin.from("leads").select(cols).eq("id", data.lead_id).maybeSingle()
        : await supabaseAdmin.from("list_leads").select(cols).eq("id", data.lead_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!lead) return { billable: true, reasons: [] };
    const l = lead as Record<string, any>;

    if (l.billable_override === true) {
      return { billable: true, reasons: ["Admin override: forced billable."] };
    }
    if (l.billable_override === false) {
      return { billable: false, reasons: ["Admin override: forced not billable."] };
    }

    const { data: vendor } = await supabaseAdmin
      .from("profiles")
      .select("full_name, company_name, email, min_vehicles, max_age")
      .eq("id", l.vendor_id)
      .maybeSingle();
    const vendorName =
      vendor?.company_name || vendor?.full_name || vendor?.email || "";
    const minVehicles =
      vendor?.min_vehicles ?? (isOneCarVendorName(vendorName) ? 1 : 2);
    const maxAge = vendor?.max_age ?? 70;

    const reasons: string[] = [];
    const positiveDispos = new Set(["sold", "quoted", "follow_up", "x_date"]);
    const hasPositive = l.dispo ? positiveDispos.has(l.dispo) : false;
    if (data.source === "list_leads" && l.not_billable) {
      reasons.push("Marked not billable.");
    }
    if (l.dispo === "already_has_allstate") reasons.push("Has Allstate.");
    if (l.dispo === "voicemail") reasons.push("Left voicemail.");
    if (!l.claimed_by && !hasPositive) {
      reasons.push("Lead was not answered/quoted.");
    } else if (l.dispo === "not_quoted") {
      reasons.push("Lead was not quoted.");
    }
    if ((l.num_vehicles ?? 0) < minVehicles) {
      reasons.push(`Vehicles ${l.num_vehicles ?? 0} < required ${minVehicles}.`);
    }
    const age = ageFromDob(l.date_of_birth ?? null);
    if (age != null && age > maxAge) reasons.push(`Age ${age} > max ${maxAge}.`);
    const carrier = (l.current_carrier ?? "").trim().toLowerCase();
    const homeCarrier = (l.current_home_carrier ?? "").trim().toLowerCase();
    if (carrier.includes("allstate") || homeCarrier.includes("allstate")) {
      reasons.push("Already has Allstate.");
    }
    return { billable: reasons.length === 0, reasons };
  });

/** Admin only: list vendors (vendor role, no parent) for the billing picker. */
export const listBillingVendors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "vendor");
    const ids = (roleRows ?? []).map((r) => r.user_id);
    type VendorEntry = {
      id: string;
      ids: string[];
      name: string;
      default_lead_rate: number | null;
      min_vehicles: number | null;
      max_age: number | null;
    };
    if (ids.length === 0) return [] as VendorEntry[];
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, company_name, email, default_lead_rate, min_vehicles, max_age, parent_vendor_id")
      .in("id", ids);

    const owners = (profiles ?? []).filter((p) => !p.parent_vendor_id);
    if (owners.length === 0) return [] as VendorEntry[];

    // Count leads per vendor profile so the most-active alias becomes canonical.
    const { data: leadCounts } = await supabaseAdmin
      .from("leads")
      .select("vendor_id");
    const { data: listCounts } = await supabaseAdmin
      .from("list_leads")
      .select("vendor_id");
    const counts = new Map<string, number>();
    for (const r of [...(leadCounts ?? []), ...(listCounts ?? [])]) {
      if (!r.vendor_id) continue;
      counts.set(r.vendor_id, (counts.get(r.vendor_id) ?? 0) + 1);
    }

    const normalize = (raw: string) =>
      raw
        .toLowerCase()
        .replace(/[\p{P}\p{S}]/gu, " ")
        .replace(
          /\b(inc|llc|ltd|corp|co|company|the|group|agency|insurance|ins)\b/g,
          " ",
        )
        .replace(/\s+/g, " ")
        .trim();

    const groups = new Map<string, typeof owners>();
    for (const p of owners) {
      const label = (p.company_name || p.full_name || p.email || "").trim();
      const key = normalize(label) || p.id;
      const arr = groups.get(key) ?? [];
      arr.push(p);
      groups.set(key, arr);
    }

    const out: VendorEntry[] = Array.from(groups.values()).map((members) => {
      const sorted = [...members].sort(
        (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0),
      );
      const primary = sorted[0];
      return {
        id: primary.id,
        ids: sorted.map((m) => m.id),
        name:
          primary.company_name || primary.full_name || primary.email || "Unknown",
        default_lead_rate: primary.default_lead_rate ?? null,
        min_vehicles: primary.min_vehicles ?? null,
        max_age: primary.max_age ?? null,
      };
    });

    return out.sort((a, b) => a.name.localeCompare(b.name));
  });

/** Admin only: all leads for a vendor (live + list) in an optional date range. */
export const getVendorBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        vendor_id: z.string().uuid(),
        vendor_ids: z.array(z.string().uuid()).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: vendor } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, company_name, email, default_lead_rate, min_vehicles, max_age")
      .eq("id", data.vendor_id)
      .maybeSingle();
    if (!vendor) throw new Error("Vendor not found");

    // Include vendor aliases (same company under different accounts) + their sub-agents.
    const aliasIds = Array.from(new Set([data.vendor_id, ...(data.vendor_ids ?? [])]));
    const { data: subRows } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .in("parent_vendor_id", aliasIds);
    const vendorIds = Array.from(
      new Set([...aliasIds, ...(subRows ?? []).map((r) => r.id)]),
    );

    const cols = "id, first_name, last_name, phone, date_of_birth, num_vehicles, dispo, quoted_premium, vendor_payout, vendor_id, agent_notes, claimed_by, created_at, billable_override, current_carrier, current_home_carrier";

    let liveQ = supabaseAdmin.from("leads").select(cols).in("vendor_id", vendorIds);
    let listQ = supabaseAdmin
      .from("list_leads")
      .select(cols + ", not_billable, list_type")
      .in("vendor_id", vendorIds);
    if (data.from) {
      liveQ = liveQ.gte("created_at", data.from);
      listQ = listQ.gte("created_at", data.from);
    }
    if (data.to) {
      liveQ = liveQ.lte("created_at", data.to);
      listQ = listQ.lte("created_at", data.to);
    }

    const [liveRes, listRes] = await Promise.all([
      liveQ.order("created_at", { ascending: false }),
      listQ.order("created_at", { ascending: false }),
    ]);
    if (liveRes.error) throw new Error(liveRes.error.message);
    if (listRes.error) throw new Error(listRes.error.message);

    const live: BillingLead[] = ((liveRes.data ?? []) as Array<Record<string, any>>).map((r) => ({
      id: String(r.id),
      first_name: r.first_name ?? null,
      last_name: r.last_name ?? null,
      phone: r.phone ?? null,
      date_of_birth: r.date_of_birth ?? null,
      num_vehicles: r.num_vehicles ?? null,
      dispo: r.dispo ?? null,
      quoted_premium: r.quoted_premium != null ? Number(r.quoted_premium) : null,
      vendor_payout: r.vendor_payout != null ? Number(r.vendor_payout) : null,
      vendor_id: String(r.vendor_id),
      agent_notes: r.agent_notes ?? null,
      claimed_by: r.claimed_by ?? null,
      created_at: String(r.created_at),
      source: "live",
      billable_override: r.billable_override ?? null,
      current_carrier: r.current_carrier ?? null,
      current_home_carrier: r.current_home_carrier ?? null,
    }));
    const list: BillingLead[] = ((listRes.data ?? []) as Array<Record<string, any>>).map((r) => ({
      id: String(r.id),
      first_name: r.first_name ?? null,
      last_name: r.last_name ?? null,
      phone: r.phone ?? null,
      date_of_birth: r.date_of_birth ?? null,
      num_vehicles: r.num_vehicles ?? null,
      dispo: r.dispo ?? null,
      quoted_premium: r.quoted_premium != null ? Number(r.quoted_premium) : null,
      vendor_payout: r.vendor_payout != null ? Number(r.vendor_payout) : null,
      vendor_id: String(r.vendor_id),
      agent_notes: r.agent_notes ?? null,
      claimed_by: r.claimed_by ?? null,
      created_at: String(r.created_at),
      source: "list",
      list_type: r.list_type ?? null,
      not_billable: !!r.not_billable,
      billable_override: r.billable_override ?? null,
      current_carrier: r.current_carrier ?? null,
      current_home_carrier: r.current_home_carrier ?? null,
    }));

    return {
      vendor: {
        id: vendor.id,
        name: vendor.company_name || vendor.full_name || vendor.email,
        default_lead_rate: vendor.default_lead_rate ?? null,
        min_vehicles: vendor.min_vehicles ?? null,
        max_age: vendor.max_age ?? null,
      },
      live,
      list,
    };
  });

/** Admin only: update a billing-relevant subset of fields on a lead. */
export const updateBillingLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        source: z.enum(["live", "list"]),
        dispo: z
          .enum(["sold", "quoted", "not_quoted", "voicemail", "follow_up", "x_date", "wrong_number", "dead"])
          .nullable()
          .optional(),
        num_vehicles: z.number().int().min(0).max(20).nullable().optional(),
        vendor_payout: z.number().min(0).max(100000).nullable().optional(),
        agent_notes: z.string().max(5000).nullable().optional(),
        not_billable: z.boolean().optional(),
        billable_override: z.boolean().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {};
    if (data.dispo !== undefined) patch.dispo = data.dispo;
    if (data.num_vehicles !== undefined) patch.num_vehicles = data.num_vehicles;
    if (data.vendor_payout !== undefined) patch.vendor_payout = data.vendor_payout;
    if (data.agent_notes !== undefined) patch.agent_notes = data.agent_notes;
    if (data.source === "list" && data.not_billable !== undefined) {
      patch.not_billable = data.not_billable;
    }
    if (data.billable_override !== undefined) {
      patch.billable_override = data.billable_override;
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const q =
      data.source === "live"
        ? supabaseAdmin.from("leads").update(patch as never).eq("id", data.id)
        : supabaseAdmin.from("list_leads").update(patch as never).eq("id", data.id);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin only: activity history for a single lead. */
export const getLeadActivities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        lead_id: z.string().uuid(),
        source: z.enum(["live", "list"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const table = data.source === "live" ? "leads" : "list_leads";
    const { data: rows, error } = await supabaseAdmin
      .from("lead_activities")
      .select("id, user_id, action, details, created_at")
      .eq("lead_table", table)
      .eq("lead_id", data.lead_id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    // Fall back to the lead's claimed_by/claimed_at when there's no logged
    // claim activity (e.g. lead was claimed before activity logging existed).
    const leadQ =
      data.source === "live"
        ? await supabaseAdmin
            .from("leads")
            .select("claimed_by, claimed_at")
            .eq("id", data.lead_id)
            .maybeSingle()
        : await supabaseAdmin
            .from("list_leads")
            .select("claimed_by, claimed_at")
            .eq("id", data.lead_id)
            .maybeSingle();
    const claimedBy = (leadQ.data?.claimed_by as string | null) ?? null;
    const claimedAt = (leadQ.data?.claimed_at as string | null) ?? null;
    const hasClaimActivity = (rows ?? []).some(
      (r) => r.action === "claimed" || r.action === "reassigned",
    );

    const userIds = Array.from(
      new Set(
        [
          ...(rows ?? []).map((r) => r.user_id),
          claimedBy,
        ].filter((x): x is string => !!x),
      ),
    );
    let nameMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      nameMap = new Map(
        (profs ?? []).map((p) => [p.id, p.full_name || p.email || p.id]),
      );
    }
    const mapped = (rows ?? []).map((r) => ({
      id: String(r.id),
      action: String(r.action),
      details: JSON.stringify(r.details ?? {}),
      created_at: String(r.created_at),
      user_name: r.user_id ? nameMap.get(r.user_id) ?? "Unknown" : "System",
    }));

    if (!hasClaimActivity && claimedBy) {
      mapped.push({
        id: `synthetic-claim-${data.lead_id}`,
        action: "claimed",
        details: JSON.stringify({ synthetic: true }),
        created_at: claimedAt ?? new Date(0).toISOString(),
        user_name: nameMap.get(claimedBy) ?? "Unknown",
      });
      mapped.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    }
    return mapped;
  });