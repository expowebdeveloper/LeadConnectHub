import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Input = z.object({
  leadId: z.string().uuid(),
  source: z.enum(["live", "list"]),
  asUserId: z.string().uuid().optional().nullable(),
});

async function resolveActingUser(callerId: string, asUserId?: string | null) {
  if (!asUserId || asUserId === callerId) {
    return { actingUser: callerId, callerIsAdmin: false };
  }

  const { data: callerRoles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId);

  const callerIsAdmin = (callerRoles ?? []).some((r) => r.role === "admin");

  return {
    actingUser: callerIsAdmin ? asUserId : callerId,
    callerIsAdmin,
  };
}

async function getAccessContext(userId: string) {
  const [{ data: roles }, { data: profile }] = await Promise.all([
    supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
    supabaseAdmin
      .from("profiles")
      .select("id, parent_vendor_id, min_vehicles, max_age")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  if (!profile) throw new Error("Profile not found");

  return {
    roles: (roles ?? []).map((r) => r.role),
    profile,
    vendorId: profile.parent_vendor_id ?? profile.id,
  };
}

async function canAccessLead(
  actingUser: string,
  roles: string[],
  vendorId: string,
  leadId: string,
  leadTable: "leads" | "list_leads",
  leadVendorId: string | null,
  transferredBy: string | null,
) {
  if (roles.includes("admin") || roles.includes("sales")) return true;
  if (roles.includes("vendor") && leadVendorId === vendorId) return true;
  if (roles.includes("telemarketer") && transferredBy === actingUser) return true;

  const { data: share } = await supabaseAdmin
    .from("lead_shares")
    .select("id")
    .eq("lead_id", leadId)
    .eq("lead_table", leadTable)
    .eq("shared_with", actingUser)
    .maybeSingle();

  return !!share;
}

async function fetchLeadBySource(source: "live" | "list", leadId: string) {
  const table = source === "live" ? "leads" : "list_leads";
  const { data: lead, error } = await supabaseAdmin
    .from(table)
    .select("*")
    .eq("id", leadId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return {
    source,
    table,
    lead,
  } as const;
}

export const getVendorLeadDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ context, data }) => {
    const { actingUser } = await resolveActingUser(context.userId, data.asUserId);
    const { roles, vendorId } = await getAccessContext(actingUser);

    const requested = await fetchLeadBySource(data.source, data.leadId);
    const fallbackSource = data.source === "live" ? "list" : "live";
    const fallback = requested.lead ? null : await fetchLeadBySource(fallbackSource, data.leadId);

    const resolved = requested.lead ? requested : fallback;
    if (!resolved?.lead) {
      return {
        lead: null,
        dispute: null,
        resolvedSource: null,
        notFound: true,
      };
    }

    const allowed = await canAccessLead(
      actingUser,
      roles,
      vendorId,
      data.leadId,
      resolved.table,
      resolved.lead.vendor_id ?? null,
      resolved.lead.transferred_by ?? null,
    );
    if (!allowed) {
      return {
        lead: null,
        dispute: null,
        resolvedSource: null,
        notFound: true,
      };
    }

    const { data: dispute } = await supabaseAdmin
      .from("lead_disputes")
      .select("*")
      .eq("lead_id", data.leadId)
      .eq("lead_source", resolved.source)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      lead: resolved.lead as any,
      dispute: dispute ?? null,
      resolvedSource: resolved.source,
      notFound: false,
    };
  });

const UpdateEmailInput = z.object({
  leadId: z.string().uuid(),
  source: z.enum(["live", "list"]),
  email: z.string().trim().email().max(255),
});

export const updateVendorLeadEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateEmailInput.parse(input))
  .handler(async ({ context, data }) => {
    const { data: callerRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isAdmin = (callerRoles ?? []).some((r) => r.role === "admin");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id, parent_vendor_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!prof) throw new Error("Profile not found");
    const vendorId = prof.parent_vendor_id ?? prof.id;

    const table = data.source === "live" ? "leads" : "list_leads";
    const { data: lead, error: fetchErr } = await supabaseAdmin
      .from(table)
      .select("id, vendor_id")
      .eq("id", data.leadId)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!lead) throw new Error("Lead not found");
    if (!isAdmin && lead.vendor_id !== vendorId) throw new Error("Lead not found");

    const { error: updErr } = await supabaseAdmin
      .from(table)
      .update({ email: data.email })
      .eq("id", data.leadId);
    if (updErr) throw new Error(updErr.message);

    return { ok: true, email: data.email };
  });