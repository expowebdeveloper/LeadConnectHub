import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type VendorPaymentLead = {
  id: string;
  source: "live" | "list";
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  dispo: string | null;
  created_at: string;
  cost: number;
  not_billable: boolean;
  not_billable_reasons: string[];
  submitted_by_name: string | null;
};

export async function computeVendorPayments(userId: string) {
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("id, default_lead_rate, parent_vendor_id, company_name, full_name, min_vehicles, max_age")
    .eq("id", userId)
    .maybeSingle();
  if (!prof) throw new Error("Profile not found");

  const vendorId = prof.parent_vendor_id ?? prof.id;
  const vendorProf = prof.parent_vendor_id
    ? (
        await supabaseAdmin
          .from("profiles")
          .select("default_lead_rate, company_name, full_name, min_vehicles, max_age")
          .eq("id", vendorId)
          .maybeSingle()
      ).data
    : prof;
  const rate = Number(vendorProf?.default_lead_rate ?? 0);
  const vendorName = vendorProf?.company_name ?? vendorProf?.full_name ?? "";
  const isOneCarVendor = (() => {
    const n = vendorName.toLowerCase();
    return n.includes("nadir") || n.includes("giga") || n.includes("sm connect");
  })();
  const minVehicles = vendorProf?.min_vehicles ?? (isOneCarVendor ? 1 : 2);
  const maxAge = vendorProf?.max_age ?? 70;

  const since = new Date();
  since.setDate(since.getDate() - 90);

  const cols =
    "id, first_name, last_name, phone, dispo, created_at, vendor_payout, billable_override, claimed_by, num_vehicles, date_of_birth, current_carrier, current_home_carrier, referred_by";

  const [liveRes, listRes] = await Promise.all([
    supabaseAdmin
      .from("leads")
      .select(cols)
      .eq("vendor_id", vendorId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("list_leads")
      .select(cols + ", not_billable, list_type")
      .eq("vendor_id", vendorId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false }),
  ]);
  if (liveRes.error) throw new Error(liveRes.error.message);
  if (listRes.error) throw new Error(listRes.error.message);

  const submitterIds = Array.from(
    new Set(
      [...(liveRes.data ?? []), ...(listRes.data ?? [])]
        .map((r: any) => r.referred_by as string | null)
        .filter((x): x is string => !!x),
    ),
  );
  const submitterNameById = new Map<string, string>();
  if (submitterIds.length) {
    const { data: subs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", submitterIds);
    for (const s of (subs ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
      submitterNameById.set(s.id, s.full_name ?? s.email ?? "Sub-agent");
    }
  }
  const submitterNameOf = (r: any): string | null =>
    r.referred_by ? submitterNameById.get(r.referred_by) ?? null : null;

  const ageFromDob = (dob: unknown): number | null => {
    if (!dob || typeof dob !== "string") return null;
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age;
  };
  const reasonsOf = (r: any): string[] => {
    const positiveDispos = new Set(["sold", "quoted", "follow_up", "x_date"]);
    const hasPositiveDispo = r.dispo ? positiveDispos.has(r.dispo) : false;
    if (r.billable_override === true) return [];
    const reasons: string[] = [];
    if (r.billable_override === false) reasons.push("Manually marked non-billable by admin");
    if (r.not_billable === true) reasons.push("Lead flagged as non-billable on the list");
    if (r.dispo === "already_has_allstate") reasons.push("Has Allstate");
    if (r.dispo === "voicemail") reasons.push("Left voicemail");
    if (!r.claimed_by && !hasPositiveDispo) reasons.push("Lead was not answered/quoted.");
    else if (r.dispo === "not_quoted") reasons.push("Lead was not quoted.");
    if ((r.num_vehicles ?? 0) < minVehicles)
      reasons.push(`Below minimum vehicles (${r.num_vehicles ?? 0} of ${minVehicles} required)`);
    const age = ageFromDob(r.date_of_birth);
    if (age != null && age > maxAge)
      reasons.push(`Over maximum age (${age}, limit ${maxAge})`);
    const carrierNorm = (r.current_carrier ?? "").trim().toLowerCase();
    const homeCarrierNorm = (r.current_home_carrier ?? "").trim().toLowerCase();
    if (carrierNorm.includes("allstate") || homeCarrierNorm.includes("allstate")) reasons.push("Has Allstate");
    return reasons;
  };
  const billableOf = (r: any): boolean => {
    if (r.billable_override === true) return true;
    return reasonsOf(r).length === 0;
  };
  const costOf = (r: any): number => {
    if (!billableOf(r)) return 0;
    const explicit = Number(r.vendor_payout);
    if (explicit > 0) return explicit;
    return rate;
  };

  const live: VendorPaymentLead[] = ((liveRes.data ?? []) as any[]).map((r) => ({
    id: String(r.id),
    source: "live",
    first_name: r.first_name ?? null,
    last_name: r.last_name ?? null,
    phone: r.phone ?? null,
    dispo: r.dispo ?? null,
    created_at: String(r.created_at),
    cost: costOf(r),
    not_billable: !billableOf(r),
    not_billable_reasons: billableOf(r) ? [] : reasonsOf(r),
    submitted_by_name: submitterNameOf(r),
  }));
  const list: VendorPaymentLead[] = ((listRes.data ?? []) as any[]).map((r) => ({
    id: String(r.id),
    source: "list",
    first_name: r.first_name ?? null,
    last_name: r.last_name ?? null,
    phone: r.phone ?? null,
    dispo: r.dispo ?? null,
    created_at: String(r.created_at),
    cost: costOf(r),
    not_billable: !billableOf(r),
    not_billable_reasons: billableOf(r) ? [] : reasonsOf(r),
    submitted_by_name: submitterNameOf(r),
  }));

  const all = [...live, ...list].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const sumIn = (since: Date) =>
    all.filter((l) => new Date(l.created_at) >= since).reduce((s, l) => s + l.cost, 0);

  return {
    rate,
    totals: {
      today: sumIn(startOfDay),
      week: sumIn(startOfWeek),
      month: sumIn(startOfMonth),
      total: all.reduce((s, l) => s + l.cost, 0),
    },
    counts: {
      total: all.length,
      billable: all.filter((l) => l.cost > 0).length,
    },
    leads: all,
  };
}

export const getVendorPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { asUserId?: string | null } | undefined) => input ?? {},
  )
  .handler(async ({ context, data }) => {
    let userId = context.userId;
    if (data?.asUserId && data.asUserId !== userId) {
      const { data: callerRoles } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId);
      if ((callerRoles ?? []).some((r) => r.role === "admin")) {
        userId = data.asUserId;
      }
    }
    // Sub-agents (vendor accounts with a parent_vendor_id) must not see
    // the parent vendor's payment data.
    const { data: callerProf } = await supabaseAdmin
      .from("profiles")
      .select("parent_vendor_id")
      .eq("id", userId)
      .maybeSingle();
    if (callerProf?.parent_vendor_id) {
      throw new Error("Forbidden");
    }
    return computeVendorPayments(userId);
  });