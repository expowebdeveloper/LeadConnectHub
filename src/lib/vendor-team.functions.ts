import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function randomToken(len = 24) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const listTeamAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const [{ data: agents }, { data: invites }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, avatar_url, created_at")
        .eq("parent_vendor_id", userId)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("vendor_invites")
        .select("id, token, label, expires_at, used_by, used_at, created_at")
        .eq("vendor_id", userId)
        .order("created_at", { ascending: false }),
    ]);
    return { agents: agents ?? [], invites: invites ?? [] };
  });

export const createTeamInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { label?: string }) => ({
    label: (input?.label ?? "").toString().slice(0, 80) || null,
  }))
  .handler(async ({ context, data }) => {
    const { userId } = context;
    // Only vendor "owners" (not sub-agents) may create invites.
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("parent_vendor_id")
      .eq("id", userId)
      .maybeSingle();
    if (prof?.parent_vendor_id) {
      throw new Error("Sub-agents cannot invite other agents.");
    }
    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roles = (roleRows ?? []).map((r) => r.role as string);
    if (!roles.includes("vendor") && !roles.includes("admin")) {
      throw new Error("Only vendor accounts can invite agents.");
    }
    const token = randomToken(24);
    const { data: inv, error } = await supabaseAdmin
      .from("vendor_invites")
      .insert({ vendor_id: userId, token, label: data.label })
      .select("id, token, label, expires_at, created_at")
      .single();
    if (error) throw new Error(error.message);
    return { invite: inv };
  });

export const revokeTeamInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => ({ id: String(input.id) }))
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const { error } = await supabaseAdmin
      .from("vendor_invites")
      .delete()
      .eq("id", data.id)
      .eq("vendor_id", userId)
      .is("used_by", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeTeamAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agent_id: string }) => ({ agent_id: String(input.agent_id) }))
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ parent_vendor_id: null })
      .eq("id", data.agent_id)
      .eq("parent_vendor_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// PUBLIC: resolve an invite token at signup time so the UI can show
// the inviting vendor company name. No auth required.
export const resolveInviteToken = createServerFn({ method: "GET" })
  .inputValidator((input: { token: string }) => ({
    token: String(input?.token ?? "").slice(0, 64),
  }))
  .handler(async ({ data }) => {
    if (!data.token) return { valid: false as const };
    const { data: inv } = await supabaseAdmin
      .from("vendor_invites")
      .select("vendor_id, expires_at, used_by")
      .eq("token", data.token)
      .maybeSingle();
    if (!inv || inv.used_by || new Date(inv.expires_at) < new Date()) {
      return { valid: false as const };
    }
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("company_name, full_name")
      .eq("id", inv.vendor_id)
      .maybeSingle();
    return {
      valid: true as const,
      vendor_company: prof?.company_name || prof?.full_name || "your vendor",
    };
  });