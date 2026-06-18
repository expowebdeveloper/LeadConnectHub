import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Admin access required");
}

function genToken(): string {
  // 32 url-safe chars
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const listPostTokens = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: tokens, error } = await supabaseAdmin
      .from("vendor_post_tokens")
      .select("id, vendor_id, token, label, active, destination, last_used_at, post_count, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const vendorIds = Array.from(new Set((tokens ?? []).map((t) => t.vendor_id)));
    let profiles: { id: string; company_name: string | null; full_name: string | null; email: string | null }[] = [];
    if (vendorIds.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, company_name, full_name, email")
        .in("id", vendorIds);
      profiles = profs ?? [];
    }
    const pmap = new Map(profiles.map((p) => [p.id, p]));
    return (tokens ?? []).map((t) => ({
      ...t,
      vendor_name:
        pmap.get(t.vendor_id)?.company_name ||
        pmap.get(t.vendor_id)?.full_name ||
        pmap.get(t.vendor_id)?.email ||
        t.vendor_id.slice(0, 8),
    }));
  });

export const createPostToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { vendor_id: string; label?: string; destination?: "live" | "shark_tank" }) =>
    z.object({
      vendor_id: z.string().uuid(),
      label: z.string().trim().max(120).optional(),
      destination: z.enum(["live", "shark_tank"]).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const token = genToken();
    const { data: row, error } = await supabaseAdmin
      .from("vendor_post_tokens")
      .insert({
        vendor_id: data.vendor_id,
        label: data.label || null,
        token,
        destination: data.destination ?? "shark_tank",
      })
      .select("id, token")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const setPostTokenActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; active: boolean }) =>
    z.object({ id: z.string().uuid(), active: z.boolean() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("vendor_post_tokens")
      .update({ active: data.active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setPostTokenDestination = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; destination: "live" | "shark_tank" }) =>
    z.object({ id: z.string().uuid(), destination: z.enum(["live", "shark_tank"]) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("vendor_post_tokens")
      .update({ destination: data.destination })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePostToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("vendor_post_tokens")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Create a "posting-only" vendor — a profile + vendor role with no expectation
 * of CRM access. Used from the Posting Links page so an admin can spin up a
 * vendor purely to hang posting URLs off of.
 */
export const createPostingOnlyVendor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { company_name: string; full_name?: string; email?: string }) =>
      z
        .object({
          company_name: z.string().trim().min(1).max(200),
          full_name: z.string().trim().max(200).optional(),
          email: z.string().trim().email().max(255).optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Generate a placeholder email when one isn't supplied — auth.users
    // requires a unique email. The "posting.local" domain signals this
    // account exists only as a vendor handle for posting links.
    let email = data.email?.toLowerCase().trim();
    if (!email) {
      const slug = data.company_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "vendor";
      const rand = Math.random().toString(36).slice(2, 8);
      email = `${slug}-${rand}@posting.local`;
    }

    // Random unguessable password — they aren't expected to log in.
    const pwBytes = new Uint8Array(24);
    crypto.getRandomValues(pwBytes);
    const password = Array.from(pwBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

    const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        company_name: data.company_name,
        full_name: data.full_name || data.company_name,
        requested_role: "vendor",
      },
    });
    if (authErr || !created?.user) {
      throw new Error(authErr?.message || "Failed to create vendor");
    }
    const newId = created.user.id;

    // handle_new_user trigger inserts profile + a 'pending' role row. Promote
    // it to a real vendor role so the user shows up in listVendors().
    await supabaseAdmin.from("user_roles").delete().eq("user_id", newId).eq("role", "pending");
    await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newId, role: "vendor" });

    // Make sure profile fields are set (the trigger reads metadata but
    // belt-and-suspenders).
    await supabaseAdmin
      .from("profiles")
      .update({
        company_name: data.company_name,
        full_name: data.full_name || data.company_name,
      })
      .eq("id", newId);

    return { id: newId, email, company_name: data.company_name };
  });