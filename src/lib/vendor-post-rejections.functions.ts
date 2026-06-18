import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type VendorPostRejection = {
  id: string;
  endpoint: string;
  reason: string;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  details: any;
  created_at: string;
};

export const listMyPostRejections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { asUserId?: string | null } | undefined) => input ?? {},
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

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

    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id, parent_vendor_id")
      .eq("id", userId)
      .maybeSingle();
    if (!prof) return [];
    const vendorId = prof.parent_vendor_id ?? prof.id;

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const { data: rows, error } = await supabaseAdmin
      .from("vendor_post_rejections")
      .select("id, endpoint, reason, phone, first_name, last_name, details, created_at")
      .eq("vendor_id", vendorId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    const result: VendorPostRejection[] = (rows ?? []).map((r: any) => ({
      id: String(r.id),
      endpoint: String(r.endpoint),
      reason: String(r.reason),
      phone: r.phone ?? null,
      first_name: r.first_name ?? null,
      last_name: r.last_name ?? null,
      details: r.details ?? {},
      created_at: String(r.created_at),
    }));
    return result;
  });