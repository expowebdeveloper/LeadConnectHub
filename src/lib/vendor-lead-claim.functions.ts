import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ leadId: z.string().uuid() });

export const getVendorLeadClaimStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: lead, error } = await supabaseAdmin
      .from("leads")
      .select("id, vendor_id, claimed_by, claimed_at, first_name, last_name")
      .eq("id", data.leadId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!lead) throw new Error("Lead not found");

    // Authorization: owning vendor (or their parent vendor) or admin
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id, parent_vendor_id")
      .eq("id", context.userId)
      .maybeSingle();
    const callerVendorId = prof?.parent_vendor_id ?? prof?.id ?? context.userId;

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");

    if (!isAdmin && lead.vendor_id !== callerVendorId && lead.vendor_id !== context.userId) {
      throw new Error("Forbidden");
    }

    let agent: { id: string; full_name: string | null; email: string | null; direct_phone: string | null; avatar_url: string | null } | null = null;
    if (lead.claimed_by) {
      const { data: a } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, direct_phone, avatar_url")
        .eq("id", lead.claimed_by)
        .maybeSingle();
      agent = a ?? null;
    }

    return {
      leadId: lead.id,
      claimedBy: lead.claimed_by as string | null,
      claimedAt: lead.claimed_at as string | null,
      agent,
    };
  });