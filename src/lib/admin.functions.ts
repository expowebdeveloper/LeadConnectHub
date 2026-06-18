import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildLeadSaleRows, type LeadSaleInput } from "@/lib/sale-rows";
import { quoteCreditKey } from "@/lib/quote-credit";
import {
  addSpeedSample,
  emptySpeedSummary,
  speedTier,
  speedToClaimSeconds,
} from "@/lib/speed-to-claim";
import {
  buildEligibilityIndex,
  bumpUnclaimed,
  emptyUnclaimedSummary,
  leadIsUnclaimed,
  wasEligibleAt,
  type CallInterval,
  type PresenceEvent,
} from "@/lib/unclaimed-rate";

/**
 * Per-agent unclaimed-rate over [from, to]. Counts every live lead that
 * popped while this agent was eligible (on-duty, not on a call, not in
 * post-call wrap-up), then flags it as "missed" if neither side was
 * claimed within 10 minutes.
 */
async function computeAgentUnclaimed(agentId: string, fromISO: string, toISO: string) {
  const fromMs = new Date(fromISO).getTime();
  const toMs = new Date(toISO).getTime();
  const [leadsRes, presenceRes, callsRes] = await Promise.all([
    supabaseAdmin
      .from("leads")
      .select("id, created_at, claimed_at, home_claimed_at")
      .gte("created_at", fromISO)
      .lte("created_at", toISO),
    supabaseAdmin
      .from("presence_events")
      .select("user_id, status, started_at")
      .eq("user_id", agentId)
      .gte("started_at", new Date(fromMs - 7 * 24 * 3600 * 1000).toISOString())
      .lte("started_at", toISO),
    Promise.resolve({ data: [] as Array<{ user_id: string | null; started_at: string | null; ended_at: string | null }> }),
  ]);

  const presence = (presenceRes.data ?? []) as PresenceEvent[];
  const calls = ((callsRes.data ?? []) as Array<{
    user_id: string | null; started_at: string | null; ended_at: string | null;
  }>)
    .filter((c): c is CallInterval => !!c.user_id && !!c.started_at)
    .map((c) => ({ user_id: c.user_id, started_at: c.started_at, ended_at: c.ended_at }));
  const idx = buildEligibilityIndex(presence, calls);

  const summary = emptyUnclaimedSummary();
  for (const l of (leadsRes.data ?? []) as Array<{
    id: string; created_at: string; claimed_at: string | null; home_claimed_at: string | null;
  }>) {
    const popTs = new Date(l.created_at).getTime();
    if (!Number.isFinite(popTs)) continue;
    if (idx.trackingSince != null && popTs < idx.trackingSince) continue;
    if (!wasEligibleAt(agentId, popTs, idx)) continue;
    bumpUnclaimed(summary, leadIsUnclaimed(l));
  }
  // Touch toMs so it's not unused — bounded the call query above.
  void toMs;
  return summary;
}

type DedupRow = {
  id: string;
  lead_id: string | null;
  lead_table: string | null;
  action: string;
  details: unknown;
  created_at: string;
};

// Collapse repeat email_sent rows to the same lead within a short window so
// the agent isn't credited multiple times for one outreach. Keeps the
// earliest row in time and drops follow-ups.
function dedupeRapidEmailSends<T extends DedupRow>(rows: T[], windowMs: number): T[] {
  const sorted = [...rows].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const lastAt = new Map<string, number>();
  const keep = new Set<T>();
  for (const r of sorted) {
    if (r.action !== "email_sent") { keep.add(r); continue; }
    const key = `${r.lead_table ?? ""}|${r.lead_id ?? ""}`;
    const ts = new Date(r.created_at).getTime();
    const prev = lastAt.get(key);
    if (prev !== undefined && ts - prev <= windowMs) continue;
    lastAt.set(key, ts);
    keep.add(r);
  }
  return rows.filter((r) => keep.has(r));
}

type AgentSalesLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  quoted_premium: number | null;
  created_at: string;
  updated_at: string | null;
  vendor_id: string | null;
  current_carrier: string | null;
  dispo: string | null;
  home_dispo: string | null;
  home_quoted_premium: number | null;
  auto_motor_club_premium: number | null;
  auto_policies_count: number | null;
  home_policies_count: number | null;
  num_vehicles: number | null;
  claimed_by: string | null;
  home_claimed_by: string | null;
  lead_lines: unknown;
};

type AgentSalesLeadLine = {
  claimed_by?: string | null;
  dispo?: string | null;
  items?: number | string | null;
  quoted_premium?: number | string | null;
  sold_at?: string | null;
  type?: string | null;
};

type AgentSaleEventRow = {
  lead_id: string;
  lead_table: "leads" | "list_leads";
  side: "auto" | "home" | "motorcycle" | "boat" | "umbrella" | "flood" | "golf_cart" | "rv";
  items_count: number | null;
  premium: number | null;
  created_at: string;
};

function buildAgentSaleRows(
  lead: AgentSalesLead,
  leadTable: "leads" | "list_leads",
  agentId: string,
): AgentSaleEventRow[] {
  const fallback = lead.updated_at ?? lead.created_at;
  return buildLeadSaleRows(lead as LeadSaleInput)
    .filter((r) => r.ownerId === agentId)
    .map((r) => ({
      lead_id: r.leadId,
      lead_table: leadTable,
      side: r.side,
      items_count: r.items,
      premium: r.premium,
      created_at: r.occurredAt ?? fallback,
    }));
}

/** Claim the first admin role — only works if no admin exists yet. */
export const claimFirstAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { count, error: countErr } = await supabaseAdmin
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "admin");
    if (countErr) throw new Error(countErr.message);
    if ((count ?? 0) > 0) {
      throw new Error("An admin already exists. Ask an existing admin to grant you access.");
    }
    // Replace any pending role and grant admin + sales
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    const { error: insErr } = await supabaseAdmin
      .from("user_roles")
      .insert([
        { user_id: userId, role: "admin" },
        { user_id: userId, role: "sales" },
      ]);
    if (insErr) throw new Error(insErr.message);
    return { ok: true };
  });

/** Mark the current user as active right now. Called on heartbeat from the client. */
export const heartbeatActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    await supabaseAdmin
      .from("profiles")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", userId);
    return { ok: true };
  });

/** List all users with their roles + profile — admin only. */
export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (meRoles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden");

    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name, company_name, requested_role, default_lead_rate, bypass_litigator, frozen, frozen_reason, frozen_at, min_vehicles, max_age, telemarketer_goal_calls, telemarketer_goal_transfers, telemarketer_goal_period, created_at, last_active_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const rolesByUser = new Map<string, string[]>();
    for (const r of roles ?? []) {
      const list = rolesByUser.get(r.user_id) ?? [];
      list.push(r.role);
      rolesByUser.set(r.user_id, list);
    }

    // Fetch last_sign_in_at from auth.users (paginated).
    const lastSignInByUser = new Map<string, string | null>();
    try {
      let page = 1;
      const perPage = 1000;
      while (true) {
        const { data: authPage, error: authErr } = await supabaseAdmin.auth.admin.listUsers({
          page,
          perPage,
        });
        if (authErr) break;
        for (const u of authPage?.users ?? []) {
          lastSignInByUser.set(u.id, u.last_sign_in_at ?? null);
        }
        if (!authPage || authPage.users.length < perPage) break;
        page += 1;
      }
    } catch (e) {
      console.error("listUsers: failed to fetch auth users", e);
    }

    // Fetch most-recent lead activity timestamp per user.
    const lastActivityByUser = new Map<string, string | null>();
    {
      const { data: acts } = await supabaseAdmin
        .from("lead_activities")
        .select("user_id, created_at")
        .not("user_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(50000);
      for (const a of acts ?? []) {
        if (!a.user_id) continue;
        if (!lastActivityByUser.has(a.user_id)) {
          lastActivityByUser.set(a.user_id, a.created_at as string);
        }
      }
    }

    return (profiles ?? []).map((p) => ({
      ...p,
      roles: rolesByUser.get(p.id) ?? [],
      last_sign_in_at: lastSignInByUser.get(p.id) ?? null,
      last_active_at:
        // Most recent of: heartbeat, auth sign-in, or actual lead activity.
        (() => {
          const toMs = (v: string | null | undefined) =>
            v ? new Date(v).getTime() : 0;
          const max = Math.max(
            toMs(p.last_active_at as string | null),
            toMs(lastSignInByUser.get(p.id)),
            toMs(lastActivityByUser.get(p.id)),
          );
          return max > 0 ? new Date(max).toISOString() : null;
        })(),
    }));
  });

/** Set the role(s) for a user — admin only. Replaces existing roles. */
export const setUserRoles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        target_user_id: z.string().uuid(),
        roles: z.array(z.enum(["admin", "sales", "vendor", "telemarketer", "pending"])).min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (meRoles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden");

    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.target_user_id);
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert(data.roles.map((role) => ({ user_id: data.target_user_id, role })));
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Delete a user — admin only. Removes auth user, profile, roles. */
export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ target_user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    if (data.target_user_id === userId) {
      throw new Error("You can't delete your own account.");
    }
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (meRoles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden");

    // Don't allow removing the last admin.
    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.target_user_id);
    const targetIsAdmin = (targetRoles ?? []).some((r) => r.role === "admin");
    if (targetIsAdmin) {
      const { count } = await supabaseAdmin
        .from("user_roles")
        .select("*", { count: "exact", head: true })
        .eq("role", "admin");
      if ((count ?? 0) <= 1) {
        throw new Error("Can't delete the last admin.");
      }
    }

    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(data.target_user_id);
    if (authDeleteError) {
      console.error("Failed to delete auth user", {
        targetUserId: data.target_user_id,
        message: authDeleteError.message,
      });
      throw new Error(authDeleteError.message || "Failed to delete user account.");
    }

    const { error: rolesDeleteError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.target_user_id);
    if (rolesDeleteError) {
      console.error("Deleted auth user but failed to delete roles", {
        targetUserId: data.target_user_id,
        message: rolesDeleteError.message,
      });
      throw new Error("User account was deleted, but role cleanup failed.");
    }

    const { error: profileDeleteError } = await supabaseAdmin
      .from("profiles")
      .delete()
      .eq("id", data.target_user_id);
    if (profileDeleteError) {
      console.error("Deleted auth user but failed to delete profile", {
        targetUserId: data.target_user_id,
        message: profileDeleteError.message,
      });
      throw new Error("User account was deleted, but profile cleanup failed.");
    }

    return { ok: true };
  });

/** Update a user's profile + email — admin only. */
export const updateUserProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        target_user_id: z.string().uuid(),
        full_name: z.string().max(200).nullable().optional(),
        company_name: z.string().max(200).nullable().optional(),
        email: z.string().email().max(320).optional(),
        default_lead_rate: z.number().min(0).max(100000).nullable().optional(),
        bypass_litigator: z.boolean().optional(),
        frozen: z.boolean().optional(),
        min_vehicles: z.number().int().min(0).max(20).nullable().optional(),
        max_age: z.number().int().min(0).max(120).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (meRoles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden");

    // Update auth email first (if changed) so we can fail cleanly.
    if (data.email) {
      const { data: current } = await supabaseAdmin
        .from("profiles")
        .select("email")
        .eq("id", data.target_user_id)
        .maybeSingle();
      if (current && current.email !== data.email) {
        const { error: emailErr } = await supabaseAdmin.auth.admin.updateUserById(
          data.target_user_id,
          { email: data.email, email_confirm: true },
        );
        if (emailErr) throw new Error(emailErr.message);
      }
    }

    const update: {
      full_name?: string | null;
      company_name?: string | null;
      email?: string;
      default_lead_rate?: number | null;
      bypass_litigator?: boolean;
      frozen?: boolean;
      frozen_reason?: string | null;
      frozen_at?: string | null;
      min_vehicles?: number | null;
      max_age?: number | null;
    } = {};
    if (data.full_name !== undefined) update.full_name = data.full_name || null;
    if (data.company_name !== undefined) update.company_name = data.company_name || null;
    if (data.email !== undefined) update.email = data.email;
    if (data.default_lead_rate !== undefined) update.default_lead_rate = data.default_lead_rate;
    if (data.bypass_litigator !== undefined) update.bypass_litigator = data.bypass_litigator;
    if (data.frozen !== undefined) {
      update.frozen = data.frozen;
      if (!data.frozen) {
        update.frozen_reason = null;
        update.frozen_at = null;
      }
    }
    if (data.min_vehicles !== undefined) update.min_vehicles = data.min_vehicles;
    if (data.max_age !== undefined) update.max_age = data.max_age;

    if (Object.keys(update).length > 0) {
      const { error } = await supabaseAdmin
        .from("profiles")
        .update(update)
        .eq("id", data.target_user_id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

/** List sales agents (for the "agent quoted" picker). Any authenticated user. */
export const listSalesAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data: roles, error } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "sales");
    if (error) throw new Error(error.message);
    const ids = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
    if (ids.length === 0) return [];
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", ids);
    return profiles ?? [];
  });

/** Lookup vendor names for a list of leads — sales/admin only. */
export const lookupVendorNames = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ vendor_ids: z.array(z.string().uuid().nullable()).transform((arr) => arr.filter((x): x is string => !!x)) }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const allowed = (meRoles ?? []).some((r) => r.role === "admin" || r.role === "sales");
    if (!allowed) return [];
    if (data.vendor_ids.length === 0) return [];
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, company_name, full_name, email, avatar_url, min_vehicles, max_age")
      .in("id", data.vendor_ids);
    return profiles ?? [];
  });

/** List all vendors — sales/admin only. Used for assigning imports. */
export const listVendors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const allowed = (meRoles ?? []).some((r) => r.role === "admin" || r.role === "sales");
    if (!allowed) return [];
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "vendor");
    const ids = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
    if (ids.length === 0) return [];
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, company_name, full_name, email")
      .in("id", ids);
    return profiles ?? [];
  });

/** Lookup profile display names for a list of user_ids — sales/admin only. */
export const lookupProfileNames = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ user_ids: z.array(z.string().uuid()) }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const allowed = (meRoles ?? []).some((r) => r.role === "admin" || r.role === "sales");
    if (!allowed) return [];
    if (data.user_ids.length === 0) return [];
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", data.user_ids);
    return profiles ?? [];
  });

/** Fetch a user (profile + roles) for admin "view-as" impersonation. */
export const getImpersonationTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ target_user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (meRoles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden");

    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, parent_vendor_id, company_name, full_name, avatar_url, frozen, frozen_reason")
      .eq("id", data.target_user_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!profile) throw new Error("User not found");

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.target_user_id);

    return {
      profile,
      roles: (roles ?? []).map((r) => r.role as string),
    };
  });

/** Per-agent activity feed + summary counts. Admin and sales agents can view. */
export const getAgentActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        agent_id: z.string().uuid(),
        from: z.string(),
        to: z.string(),
        limit: z.number().int().min(1).max(2000).default(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (meRoles ?? []).some((r) => r.role === "admin");
    const isSales = (meRoles ?? []).some((r) => r.role === "sales");
    if (!isAdmin && !isSales) throw new Error("Forbidden");

    // If caller is sales (not admin), verify target is a sales agent.
    if (!isAdmin) {
      const { data: targetRoles } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", data.agent_id);
      const targetIsSales = (targetRoles ?? []).some((r) => r.role === "sales");
      if (!targetIsSales) throw new Error("Forbidden");
    }

    const { data: rows, error } = await supabaseAdmin
      .from("lead_activities")
      .select("id, lead_id, lead_table, action, details, created_at")
      .eq("user_id", data.agent_id)
      .gte("created_at", data.from)
      .lte("created_at", data.to)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);

    // Collapse rapid-fire duplicate email_sent rows to the same lead so the
    // feed and summary don't double-credit one outreach. 30-minute window.
    const dedupedRows = dedupeRapidEmailSends(rows ?? [], 30 * 60_000);

    // For any "initiated" call_logged rows, try to backfill the real outcome
    // from call_logs (linked via lead_activity_id) so the activity feed shows
    // the actual call result (e.g. answered / voicemail / no_answer) instead
    // of a permanently-pending badge.
    const pendingCallIds = dedupedRows
      .filter((r) => {
        if (r.action !== "call_logged") return false;
        const d = (r.details ?? {}) as Record<string, unknown>;
        return String(d.outcome ?? "") === "initiated";
      })
      .map((r) => r.id);
    if (pendingCallIds.length) {
      const { data: logs } = await supabaseAdmin
        .from("call_logs")
        .select("lead_activity_id, outcome, status, duration_seconds, hangup_cause")
        .in("lead_activity_id", pendingCallIds);
      const byActivity = new Map<string, { outcome?: string | null; status?: string | null; duration_seconds?: number | null; hangup_cause?: string | null }>();
      for (const l of logs ?? []) {
        if (!l.lead_activity_id) continue;
        byActivity.set(l.lead_activity_id, l);
      }
      for (const r of dedupedRows) {
        if (r.action !== "call_logged") continue;
        const log = byActivity.get(r.id);
        if (!log) continue;
        const real = log.outcome ?? log.status ?? null;
        if (!real || real === "initiated") continue;
        const d = (r.details ?? {}) as Record<string, unknown>;
        r.details = {
          ...d,
          outcome: real,
          ...(log.duration_seconds != null ? { duration_seconds: log.duration_seconds } : {}),
          ...(log.hangup_cause ? { hangup_cause: log.hangup_cause } : {}),
          auto_finalized: true,
        };
      }
    }

    const liveIds = Array.from(
      new Set(dedupedRows.filter((r) => r.lead_table === "leads").map((r) => r.lead_id)),
    );
    const listIds = Array.from(
      new Set(dedupedRows.filter((r) => r.lead_table === "list_leads").map((r) => r.lead_id)),
    );
    const leadMap = new Map<string, { name: string; phone: string | null }>();
    // Track live-lead created_at so we can compute speed-to-claim per
    // claim activity (claimed_at = activity.created_at, created_at = lead).
    const liveCreatedById = new Map<string, string>();
    if (liveIds.length) {
      const { data: leads } = await supabaseAdmin
        .from("leads")
        .select("id, first_name, last_name, phone, created_at")
        .in("id", liveIds);
      for (const l of leads ?? []) {
        leadMap.set(`leads:${l.id}`, {
          name: `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "(no name)",
          phone: l.phone,
        });
        if (l.created_at) liveCreatedById.set(l.id, l.created_at);
      }
    }
    if (listIds.length) {
      const { data: leads } = await supabaseAdmin
        .from("list_leads")
        .select("id, first_name, last_name, phone")
        .in("id", listIds);
      for (const l of leads ?? []) {
        leadMap.set(`list_leads:${l.id}`, {
          name: `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "(no name)",
          phone: l.phone,
        });
      }
    }

    const summary: Record<string, number> = {};
    const claimedLeads = new Set<string>();
    const quotedLeads = new Set<string>();
    const soldLeads = new Set<string>();
    const callLeads = new Set<string>();
    const speedSummary = emptySpeedSummary();
    // First-time live-lead claim per (lead_id, side). If the agent
    // re-claims after a release, we only score the first claim.
    // dedupedRows is newest-first; sort claims ascending so the oldest
    // claim per (lead, side) wins.
    const speedTiersByRowId = new Map<string, { sec: number; tier: ReturnType<typeof speedTier> }>();
    {
      const seenClaimKey = new Set<string>();
      const claimsAsc = dedupedRows
        .filter((r) => r.action === "claimed" && r.lead_table === "leads" && r.lead_id)
        .slice()
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      for (const r of claimsAsc) {
        const d = (r.details ?? {}) as Record<string, unknown>;
        const side = String(d.side ?? "").toLowerCase().trim() || "unknown";
        const lineKey = `${r.lead_table}:${r.lead_id}:${side}`;
        if (seenClaimKey.has(lineKey)) continue;
        seenClaimKey.add(lineKey);
        const createdAt = liveCreatedById.get(r.lead_id!);
        const sec = speedToClaimSeconds(createdAt, r.created_at);
        if (sec == null) continue;
        addSpeedSample(speedSummary, sec);
        speedTiersByRowId.set(r.id, { sec, tier: speedTier(sec) });
      }
    }

    for (const r of dedupedRows) {
      summary[r.action] = (summary[r.action] ?? 0) + 1;
      const key = `${r.lead_table}:${r.lead_id}`;
      const d = (r.details ?? {}) as Record<string, unknown>;
      const side = String(d.side ?? "").toLowerCase().trim() || "unknown";
      const lineKey = `${key}:${side}`;
      if (r.action === "claimed") claimedLeads.add(key);
      if (r.action === "call_logged") callLeads.add(key);
      const speedAnno = speedTiersByRowId.get(r.id);
      if (speedAnno) {
        r.details = { ...d, speed_seconds: speedAnno.sec, speed_tier: speedAnno.tier };
      }
      if (r.action === "dispo_changed") {
        const to = String(d.to ?? "");
        if (to === "sold") soldLeads.add(lineKey);
      }
      if (r.action === "quoted_premium_changed" || r.action === "line_premium_changed") {
        const qk = quoteCreditKey({
          action: r.action,
          lead_id: r.lead_id,
          lead_table: r.lead_table,
          details: d,
        });
        if (qk) quotedLeads.add(qk);
      }
    }

    return {
      canSeeDetails: isAdmin,
      activities: isAdmin
        ? dedupedRows.map((r) => ({
            ...r,
            lead: leadMap.get(`${r.lead_table}:${r.lead_id}`) ?? null,
          }))
        : [],
      summary: {
        total: dedupedRows.length,
        byAction: summary,
        claims: claimedLeads.size,
        quotes: quotedLeads.size,
        sold: soldLeads.size,
        calls: callLeads.size,
        speedToClaim: speedSummary,
        unclaimed: await computeAgentUnclaimed(data.agent_id, data.from, data.to),
      },
    };
  });

export const getActivityDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ activity_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (meRoles ?? []).some((r) => r.role === "admin");
    const isSales = (meRoles ?? []).some((r) => r.role === "sales");
    if (!isAdmin && !isSales) throw new Error("Forbidden");

    const { data: act, error } = await supabaseAdmin
      .from("lead_activities")
      .select("id, lead_id, lead_table, user_id, action, details, created_at")
      .eq("id", data.activity_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!act) throw new Error("Activity not found");

    const det = JSON.parse(JSON.stringify(act.details ?? {})) as Record<string, string | number | boolean | null>;

    // Resolve actor profile
    type Profile = { id: string; full_name: string | null; email: string | null; avatar_url: string | null };
    let actor: Profile | null = null;
    if (act.user_id) {
      const { data: p } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, avatar_url")
        .eq("id", act.user_id)
        .maybeSingle();
      if (p) actor = p as Profile;
    }

    const base = {
      id: act.id,
      action: act.action,
      created_at: act.created_at,
      lead_id: act.lead_id,
      lead_table: act.lead_table,
      actor,
      details: det,
    };

    if (act.action === "note_added" || act.action === "note_edited") {
      const noteId = typeof det.note_id === "string" ? det.note_id : null;
      if (noteId) {
        const { data: note } = await supabaseAdmin
          .from("lead_notes")
          .select("id, body, created_at, edited_at, author_id, line_key")
          .eq("id", noteId)
          .maybeSingle();
        if (note) {
          let author: Profile | null = actor;
          if (note.author_id && (!author || author.id !== note.author_id)) {
            const { data: ap } = await supabaseAdmin
              .from("profiles")
              .select("id, full_name, email, avatar_url")
              .eq("id", note.author_id)
              .maybeSingle();
            if (ap) author = ap as Profile;
          }
          return { ...base, kind: "note" as const, note: { ...note, author } };
        }
      }
      return { ...base, kind: "note" as const, note: null };
    }

    if (act.action === "call_logged") {
      const { data: log } = await supabaseAdmin
        .from("call_logs")
        .select("id, direction, outcome, status, from_number, to_number, started_at, answered_at, ended_at, duration_seconds, hangup_cause, recording_url, notes")
        .eq("lead_activity_id", act.id)
        .maybeSingle();
      return { ...base, kind: "call" as const, call: log ?? null };
    }

    if (act.action === "email_sent") {
      return { ...base, kind: "email" as const };
    }

    return { ...base, kind: "generic" as const };
  });

export const getAgentSalesDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        agent_id: z.string().uuid(),
        from: z.string(),
        to: z.string(),
        limit: z.number().int().min(1).max(5000).default(2000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (meRoles ?? []).some((r) => r.role === "admin");
    const isSales = (meRoles ?? []).some((r) => r.role === "sales");
    if (!isAdmin && !isSales) throw new Error("Forbidden");

    if (!isAdmin) {
      const { data: targetRoles } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", data.agent_id);
      const targetIsSales = (targetRoles ?? []).some((r) => r.role === "sales");
      if (!targetIsSales) throw new Error("Forbidden");
    }

    const soldCols =
      "id, first_name, last_name, phone, city, state, quoted_premium, created_at, updated_at, vendor_id, current_carrier, dispo, home_dispo, home_quoted_premium, auto_motor_club_premium, auto_policies_count, home_policies_count, num_vehicles, claimed_by, home_claimed_by, lead_lines";

    const [live, list, eventsRes] = await Promise.all([
      supabaseAdmin
        .from("leads")
        .select(soldCols)
        .or("dispo.eq.sold,home_dispo.eq.sold")
        .order("updated_at", { ascending: false })
        .limit(data.limit),
      supabaseAdmin
        .from("list_leads")
        .select(soldCols)
        .or("dispo.eq.sold,home_dispo.eq.sold")
        .order("updated_at", { ascending: false })
        .limit(data.limit),
      supabaseAdmin
        .from("sale_events")
        .select("lead_id, lead_table, side, created_at")
        .eq("agent_id", data.agent_id)
        .gte("created_at", data.from)
        .lte("created_at", data.to)
        .order("created_at", { ascending: true })
        .limit(20000),
    ]);

    if (live.error) throw new Error(live.error.message);
    if (list.error) throw new Error(list.error.message);

    // Authoritative timestamp map: earliest sale_event per (table, lead, side).
    // Replaces lead.updated_at, which moves on every unrelated lead edit.
    const eventAt = new Map<string, string>();
    for (const ev of (eventsRes?.data ?? []) as Array<{
      lead_id: string; lead_table: string; side: string; created_at: string;
    }>) {
      const key = `${ev.lead_table}:${ev.lead_id}:${ev.side}`;
      if (!eventAt.has(key)) eventAt.set(key, ev.created_at);
    }

    return [
      ...(live.data ?? []).map((lead) => ({ ...lead, _table: "leads" as const })),
      ...(list.data ?? []).map((lead) => ({ ...lead, _table: "list_leads" as const })),
    ]
      .map((lead) => ({
        ...lead,
        _saleEvents: buildAgentSaleRows(lead as AgentSalesLead, lead._table, data.agent_id).map(
          (event) => {
            const key = `${lead._table}:${event.lead_id}:${event.side}`;
            const authoritative = eventAt.get(key);
            return authoritative ? { ...event, created_at: authoritative } : event;
          },
        ),
      }))
      .map((lead) => ({
        ...lead,
        _saleEvents: lead._saleEvents.filter((event) => {
          const t = new Date(event.created_at).getTime();
          return t >= new Date(data.from).getTime() && t <= new Date(data.to).getTime();
        }),
      }))
      .filter((lead) => lead._saleEvents.length > 0)
      .sort(
        (a, b) =>
          new Date(b.updated_at ?? b.created_at).getTime() -
          new Date(a.updated_at ?? a.created_at).getTime(),
      );
  });

/** Admin-only: manually create a new user with email/password + roles + profile. */
export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        email: z.string().email().max(320),
        password: z.string().min(8).max(200),
        full_name: z.string().max(200).optional().default(""),
        company_name: z.string().max(200).optional().default(""),
        roles: z
          .array(z.enum(["admin", "sales", "vendor", "telemarketer", "pending"]))
          .min(1),
        default_lead_rate: z.number().min(0).max(100000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (meRoles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden");

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: data.full_name || undefined,
        company_name: data.company_name || undefined,
      },
    });
    if (createErr || !created?.user) {
      throw new Error(createErr?.message || "Failed to create user");
    }
    const newId = created.user.id;

    // The handle_new_user trigger creates a profile + 'pending' role.
    // Replace with the chosen roles, and update profile fields.
    await supabaseAdmin.from("user_roles").delete().eq("user_id", newId);
    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert(data.roles.map((role) => ({ user_id: newId, role })));
    if (roleErr) throw new Error(roleErr.message);

    const profileUpdate: { full_name: string | null; company_name: string | null; email: string; default_lead_rate?: number | null } = {
      full_name: data.full_name || null,
      company_name: data.company_name || null,
      email: data.email,
    };
    if (data.default_lead_rate !== undefined) {
      profileUpdate.default_lead_rate = data.default_lead_rate;
    }
    await supabaseAdmin.from("profiles").update(profileUpdate).eq("id", newId);

    return { ok: true, user_id: newId };
  });

/** Admin-only: set a new password for any user. Returns the password so admin can share it once. */
export const adminSetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        target_user_id: z.string().uuid(),
        password: z.string().min(8).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (meRoles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden");

    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.target_user_id, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    return { ok: true, password: data.password };
  });

/** Admin-only: send a password reset email to a user. */
export const adminSendPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        target_user_id: z.string().uuid(),
        redirect_to: z.string().url().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (meRoles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden");

    const { data: u, error: getErr } = await supabaseAdmin.auth.admin.getUserById(
      data.target_user_id,
    );
    if (getErr || !u?.user?.email) throw new Error(getErr?.message || "User has no email");

    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(u.user.email, {
      redirectTo: data.redirect_to,
    });
    if (error) throw new Error(error.message);
    return { ok: true, email: u.user.email };
  });

/* ============================================================
   Agent presence / status
   ============================================================ */

export const STATUS_VALUES = ["available", "lunch", "break", "meeting", "dnd", "offline", "idle"] as const;
export type ManualStatus = (typeof STATUS_VALUES)[number];
export type PresenceStatus = ManualStatus | "on_call" | "in_tank";

export const DEFAULT_IDLE_THRESHOLD_MINUTES = 7;

/** Read the org-wide idle threshold (minutes). Available to all authed users. */
export const getIdleThresholdMinutes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .is("workspace_id", null)
      .eq("key", "presence")
      .maybeSingle();
    const v = (data?.value as { idle_threshold_minutes?: number } | null) ?? null;
    const n = Number(v?.idle_threshold_minutes);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_IDLE_THRESHOLD_MINUTES;
  });

/**
 * Auto-mark the current user as idle (or clear it). Only writes when it
 * won't clobber a user-chosen manual status (lunch/break/meeting/dnd).
 */
export const setIdleAuto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ idle: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("manual_status")
      .eq("id", userId)
      .maybeSingle();
    const cur = (prof?.manual_status as ManualStatus | null) ?? null;
    if (data.idle) {
      // Don't override an explicit user-chosen status.
      if (cur && cur !== "idle" && cur !== "available") return { ok: true, skipped: true };
      const { error } = await supabaseAdmin
        .from("profiles")
        .update({ manual_status: "idle", manual_status_until: null, manual_status_note: null })
        .eq("id", userId);
      if (error) throw new Error(error.message);
    } else {
      if (cur !== "idle") return { ok: true, skipped: true };
      const { error } = await supabaseAdmin
        .from("profiles")
        .update({
          manual_status: null,
          manual_status_until: null,
          manual_status_note: null,
          last_active_at: new Date().toISOString(),
        })
        .eq("id", userId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export type TeamPresence = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  manual_status: ManualStatus | null;
  manual_status_until: string | null;
  manual_status_note: string | null;
  last_active_at: string | null;
  on_call: boolean;
  on_call_lead_id: string | null;
  status: PresenceStatus;
};

/** Set the current user's manual status. Pass status=null to clear. */
export const setMyStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        status: z.enum(STATUS_VALUES).nullable(),
        minutes: z.number().int().positive().max(720).optional(),
        note: z.string().max(120).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const until =
      data.status && data.minutes
        ? new Date(Date.now() + data.minutes * 60_000).toISOString()
        : null;
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        manual_status: data.status,
        manual_status_until: until,
        manual_status_note: data.status ? data.note ?? null : null,
      })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Live presence for every sales/admin agent — used by the team status strip. */
export const listTeamPresence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const allowed = (meRoles ?? []).some(
      (r) => r.role === "admin" || r.role === "sales" || r.role === "vendor",
    );
    if (!allowed) return [] as TeamPresence[];

    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["sales", "admin"]);
    const ids = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)));
    if (ids.length === 0) return [] as TeamPresence[];

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, full_name, email, avatar_url, manual_status, manual_status_until, manual_status_note, last_active_at",
      )
      .in("id", ids);

    // Detect on-call: an agent counts as on-call when they hold an undisposed
    // claim on a LIVE lead (the `leads` table) made within the freshness
    // window. list_leads claims do NOT count — those are list/marketing leads
    // the agent opened in the queue, not an active call. We use claimed_by
    // (not agent_id) because agent_id is also set by vendor/owner assignment.
    const ON_CALL_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours
    const onCallSinceMs = Date.now() - ON_CALL_MAX_AGE_MS;
    const onCallSinceIso = new Date(onCallSinceMs).toISOString();
    const COMMON_COLS =
      "id, claimed_by, claimed_at, dispo, home_claimed_by, home_claimed_at, home_dispo, created_at";
    const leadsRes = await supabaseAdmin
      .from("leads")
      .select(COMMON_COLS)
      .or(
        `claimed_by.in.(${ids.join(",")}),home_claimed_by.in.(${ids.join(",")})`,
      );
    const liveLeads = leadsRes.data ?? [];

    const activeLeadIdsByAgent = new Map<string, { ts: number; id: string }>();
    const considerSide = (
      agentId: string | null,
      stamp: string | null,
      dispo: string | null,
      leadId: string,
      fallback: string | null,
    ) => {
      if (!agentId || !ids.includes(agentId)) return;
      if (dispo) return; // disposed side — doesn't count as on-call
      const s = stamp ?? fallback;
      if (!s) return;
      const ts = new Date(s).getTime();
      // Freshness gate: stale claims don't count as on-call.
      if (Number.isNaN(ts) || ts < onCallSinceMs) return;
      const prev = activeLeadIdsByAgent.get(agentId);
      if (!prev || ts > prev.ts) {
        activeLeadIdsByAgent.set(agentId, { ts, id: leadId });
      }
    };
    for (const l of liveLeads) {
      considerSide(l.claimed_by, l.claimed_at, l.dispo, l.id, l.created_at);
      considerSide(l.home_claimed_by, l.home_claimed_at, l.home_dispo, l.id, l.created_at);
    }

    // Also treat an agent as on-call if they initiated a call within the last
    // 15 minutes and haven't logged a call-outcome activity since. This covers
    // the case where the agent clicks "call" but never claims/dispos the lead.
    const CALL_WINDOW_MS = 15 * 60 * 1000;
    // Load activity over the full on-call window so we can detect when an
    // agent has "moved on" from a stale undisposed claim (e.g. they disposed
    // a different lead more recently). The initiated-call check below still
    // applies the tighter 15-minute freshness gate.
    const activitySinceIso = new Date(Date.now() - ON_CALL_MAX_AGE_MS).toISOString();
    const { data: recentActivity } = await supabaseAdmin
      .from("lead_activities")
      .select("user_id, action, details, lead_id, lead_table, created_at")
      .in("user_id", ids)
      .gte("created_at", activitySinceIso)
      .order("created_at", { ascending: false });

    type Act = {
      user_id: string | null;
      action: string;
      details: unknown;
      lead_id: string | null;
      lead_table: string | null;
      created_at: string;
    };
    // For each agent, find latest call_logged with outcome=initiated and no
    // newer activity on the same lead from that agent (which would mean the
    // agent picked an outcome / disposed).
    const initiatedByAgent = new Map<string, { ts: number; id: string; table: string }>();
    // An agent counts as "on a call" only if their globally most-recent
    // activity (across all leads) is a `call_logged` event with
    // outcome=initiated. Any newer activity — a terminal call outcome, a
    // disposition, claiming a different lead, releasing, notes — means the
    // agent has moved on and is no longer on that call. A same-lead `claimed`
    // activity does NOT invalidate on-call; it is part of establishing it.
    const newestActPerAgent = new Map<string, Act>();
    for (const a of (recentActivity ?? []) as Act[]) {
      if (!a.user_id) continue;
      if (!newestActPerAgent.has(a.user_id)) {
        newestActPerAgent.set(a.user_id, a); // sorted desc → first wins
      }
    }
    // Find the most recent `call_logged` outcome=initiated per agent — but
    // only flag it as on-call if NO newer activity has happened on any lead
    // since (dispo_changed, agent_notes_edited, terminal call_logged, etc.).
    // Otherwise the agent has clearly moved on.
    for (const a of (recentActivity ?? []) as Act[]) {
      if (!a.user_id) continue;
      if (a.action !== "call_logged") continue;
      const outcome = (a.details as { outcome?: string } | null)?.outcome;
      if (outcome !== "initiated") continue;
      if (initiatedByAgent.has(a.user_id)) continue;
      const newest = newestActPerAgent.get(a.user_id);
      const initiatedTs = new Date(a.created_at).getTime();
      if (newest) {
        const newestTs = new Date(newest.created_at).getTime();
        const newestOutcome = (newest.details as { outcome?: string } | null)?.outcome;
        const isSameInitiated =
          newest.action === "call_logged" &&
          newestOutcome === "initiated" &&
          newest.lead_id === a.lead_id &&
          (newest.lead_table ?? "leads") === (a.lead_table ?? "leads");
        if (newestTs > initiatedTs && !isSameInitiated) {
          // Agent has done something newer — they're not on this call anymore.
          continue;
        }
      }
      initiatedByAgent.set(a.user_id, {
        ts: initiatedTs,
        id: a.lead_id ?? "",
        table: a.lead_table ?? "leads",
      });
    }

    // Also clear initiated-on-call when the referenced lead now has a dispo
    // on the auto side (live leads only — list_leads aren't counted anyway).
    const initiatedLeadIds = Array.from(initiatedByAgent.values())
      .filter((v) => v.table === "leads" && v.id)
      .map((v) => v.id);
    if (initiatedLeadIds.length > 0) {
      const { data: dispoed } = await supabaseAdmin
        .from("leads")
        .select("id, dispo")
        .in("id", initiatedLeadIds);
      const dispoMap = new Map<string, string | null>(
        (dispoed ?? []).map((r) => [r.id as string, (r.dispo as string | null) ?? null]),
      );
      for (const [uid, info] of Array.from(initiatedByAgent.entries())) {
        if (info.table !== "leads") continue;
        if (dispoMap.get(info.id)) {
          initiatedByAgent.delete(uid);
        }
      }
    }

    const now = Date.now();
    const rows: TeamPresence[] = (profiles ?? []).map((p) => {
      const live = activeLeadIdsByAgent.get(p.id);
      // An undisposed fresh claim on a live lead always counts as on-call,
      // regardless of any newer activity the agent has logged elsewhere.
      // The claim is the source of truth — it only clears when the agent
      // dispos the lead (handled upstream in activeLeadIdsByAgent).
      const claimedOnCall = !!live;
      const initiated = initiatedByAgent.get(p.id);
      const initiatedOnCall = !!initiated && now - initiated.ts <= CALL_WINDOW_MS;
      const on_call = claimedOnCall || initiatedOnCall;
      const expired =
        p.manual_status_until && new Date(p.manual_status_until).getTime() <= now;
      let manual = expired ? null : (p.manual_status as ManualStatus | null);
      // Auto-idle is set by a per-tab inactivity timer, but server-side actions
      // (notes edits, dispo changes, calls, etc.) bump `last_active_at`. If the
      // user has been active server-side more recently than the idle threshold,
      // ignore a stale auto-idle flag so they don't appear Idle while working.
      if (manual === "idle" && p.last_active_at) {
        const sinceMs = now - new Date(p.last_active_at).getTime();
        if (sinceMs < 3 * 60_000) manual = null;
      }
      const status: PresenceStatus = on_call
        ? "on_call"
        : manual ?? "offline";
      // If we have no manual status and recent activity, treat as available.
      const effectiveStatus: PresenceStatus =
        status === "offline" && p.last_active_at && now - new Date(p.last_active_at).getTime() < 10 * 60_000
          ? "available"
          : status;
      const onCallLeadId = claimedOnCall
        ? live!.id
        : initiatedOnCall
          ? initiated!.id
          : null;
      return {
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        avatar_url: p.avatar_url,
        manual_status: manual,
        manual_status_until: expired ? null : p.manual_status_until,
        manual_status_note: expired ? null : p.manual_status_note,
        last_active_at: p.last_active_at,
        on_call,
        on_call_lead_id: on_call ? onCallLeadId : null,
        status: effectiveStatus,
      };
    });

    const order: Record<PresenceStatus, number> = {
      on_call: 0,
      in_tank: 1,
      available: 2,
      meeting: 3,
      lunch: 4,
      break: 5,
      dnd: 6,
      idle: 6,
      offline: 7,
    };
    rows.sort((a, b) => {
      const d = order[a.status] - order[b.status];
      if (d !== 0) return d;
      return (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? "");
    });
    return rows;
  });

/**
 * Debug the on-call computation: returns every step + sample query rows so
 * admins can see exactly why an agent is (or isn't) flagged as on-call.
 * Mirrors the logic in listTeamPresence but emits trace data instead.
 */
export const debugOnCall = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (meRoles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden");

    const log: string[] = [];
    const t0 = Date.now();
    const push = (msg: string) =>
      log.push(`[+${String(Date.now() - t0).padStart(4, "0")}ms] ${msg}`);

    const ON_CALL_MAX_AGE_MS = 6 * 60 * 60 * 1000;
    const CALL_WINDOW_MS = 15 * 60 * 1000;
    const onCallSinceMs = Date.now() - ON_CALL_MAX_AGE_MS;
    const onCallSinceIso = new Date(onCallSinceMs).toISOString();
    const callSinceIso = new Date(Date.now() - CALL_WINDOW_MS).toISOString();
    const activitySinceIso = new Date(Date.now() - ON_CALL_MAX_AGE_MS).toISOString();
    push(`config: ON_CALL_MAX_AGE=6h cutoff=${onCallSinceIso}`);
    push(`config: CALL_WINDOW=15m cutoff=${callSinceIso}`);

    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["sales", "admin"]);
    const ids = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)));
    push(`step 1: loaded ${ids.length} sales/admin user ids`);

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, last_active_at")
      .in("id", ids);
    const nameById = new Map(
      (profiles ?? []).map((p) => [p.id, p.full_name ?? p.email ?? p.id]),
    );
    push(`step 2: loaded ${profiles?.length ?? 0} profiles`);

    const COMMON_COLS =
      "id, claimed_by, claimed_at, dispo, home_claimed_by, home_claimed_at, home_dispo, created_at";
    const leadsRes = await supabaseAdmin
      .from("leads")
      .select(COMMON_COLS)
      .or(
        `claimed_by.in.(${ids.join(",")}),home_claimed_by.in.(${ids.join(",")})`,
      );
    const leadsRows = leadsRes.data ?? [];
    const listRows: typeof leadsRows = [];
    push(
      `step 3: queried claimed live leads only — leads=${leadsRows.length} (list_leads excluded by design)`,
    );

    type SideTrace = {
      lead_id: string;
      table: "leads" | "list_leads";
      side: "auto" | "home";
      agent_id: string | null;
      agent_name: string | null;
      stamp: string | null;
      dispo: string | null;
      decision: "on_call" | "skipped_dispo" | "skipped_stale" | "skipped_no_claim";
      reason: string;
    };
    const sideTraces: SideTrace[] = [];
    const activeLeadIdsByAgent = new Map<string, { ts: number; id: string }>();

    const considerSide = (
      table: "leads" | "list_leads",
      side: "auto" | "home",
      agentId: string | null,
      stamp: string | null,
      dispo: string | null,
      leadId: string,
      fallback: string | null,
    ) => {
      const trace: SideTrace = {
        lead_id: leadId,
        table,
        side,
        agent_id: agentId,
        agent_name: agentId ? nameById.get(agentId) ?? null : null,
        stamp: stamp ?? fallback,
        dispo,
        decision: "on_call",
        reason: "",
      };
      if (!agentId || !ids.includes(agentId)) {
        trace.decision = "skipped_no_claim";
        trace.reason = "no agent / not sales-admin";
        sideTraces.push(trace);
        return;
      }
      if (dispo) {
        trace.decision = "skipped_dispo";
        trace.reason = `disposed=${dispo}`;
        sideTraces.push(trace);
        return;
      }
      const s = stamp ?? fallback;
      if (!s) {
        trace.decision = "skipped_no_claim";
        trace.reason = "no timestamp";
        sideTraces.push(trace);
        return;
      }
      const ts = new Date(s).getTime();
      if (Number.isNaN(ts) || ts < onCallSinceMs) {
        trace.decision = "skipped_stale";
        trace.reason = `stamp ${s} < cutoff ${onCallSinceIso}`;
        sideTraces.push(trace);
        return;
      }
      const prev = activeLeadIdsByAgent.get(agentId);
      if (!prev || ts > prev.ts) {
        activeLeadIdsByAgent.set(agentId, { ts, id: leadId });
      }
      trace.reason = "fresh undisposed claim";
      sideTraces.push(trace);
    };

    for (const l of leadsRows) {
      considerSide("leads", "auto", l.claimed_by, l.claimed_at, l.dispo, l.id, l.created_at);
      considerSide("leads", "home", l.home_claimed_by, l.home_claimed_at, l.home_dispo, l.id, l.created_at);
    }
    for (const l of listRows) {
      considerSide("list_leads", "auto", l.claimed_by, l.claimed_at, l.dispo, l.id, l.created_at);
      considerSide("list_leads", "home", l.home_claimed_by, l.home_claimed_at, l.home_dispo, l.id, l.created_at);
    }
    push(
      `step 4: scored ${sideTraces.length} sides — kept=${[...activeLeadIdsByAgent.keys()].length} agents`,
    );

    const { data: recentActivity } = await supabaseAdmin
      .from("lead_activities")
      .select("user_id, action, details, lead_id, lead_table, created_at")
      .in("user_id", ids)
      .gte("created_at", activitySinceIso)
      .order("created_at", { ascending: false });
    push(
      `step 5: loaded ${recentActivity?.length ?? 0} recent activities (last 6h)`,
    );

    type Act = {
      user_id: string | null;
      action: string;
      details: unknown;
      lead_id: string | null;
      lead_table: string | null;
      created_at: string;
    };
    const initiatedByAgent = new Map<string, { ts: number; id: string; table: string }>();
    // Agent is on a call only if their globally most-recent activity is a
    // call_logged with outcome=initiated. Any newer activity (terminal
    // outcome, dispo, claim of another lead, release, notes) means they've
    // moved on. A same-lead `claimed` event does not invalidate the claim.
    // Mirrors listTeamPresence.
    const newestActPerAgent = new Map<string, Act>();
    for (const a of (recentActivity ?? []) as Act[]) {
      if (!a.user_id) continue;
      if (!newestActPerAgent.has(a.user_id)) {
        newestActPerAgent.set(a.user_id, a);
      }
    }
    for (const [uid, a] of newestActPerAgent) {
      if (a.action !== "call_logged") continue;
      const outcome = (a.details as { outcome?: string } | null)?.outcome;
      if (outcome !== "initiated") continue;
      initiatedByAgent.set(uid, {
        ts: new Date(a.created_at).getTime(),
        id: a.lead_id ?? "",
        table: a.lead_table ?? "leads",
      });
    }
    push(
      `step 6: ${initiatedByAgent.size} agents have a fresh initiated-call signal`,
    );

    const now = Date.now();
    const perAgent = (profiles ?? []).map((p) => {
      const live = activeLeadIdsByAgent.get(p.id);
      const initiated = initiatedByAgent.get(p.id);
      const newestAct = newestActPerAgent.get(p.id);
      let claimedOnCall = !!live;
      let movedOnReason: string | null = null;
      if (claimedOnCall && newestAct) {
        const actTs = new Date(newestAct.created_at).getTime();
        const outcome = (newestAct.details as { outcome?: string } | null)?.outcome;
        const stillOnCallAct =
          newestAct.action === "call_logged" && outcome === "initiated";
        const sameLeadClaimAct =
          newestAct.action === "claimed" &&
          (newestAct.lead_table ?? "leads") === "leads" &&
          newestAct.lead_id === live!.id;
        if (actTs > live!.ts && !stillOnCallAct && !sameLeadClaimAct) {
          claimedOnCall = false;
          movedOnReason = `newer activity ${newestAct.action}${outcome ? `/${outcome}` : ""} at ${newestAct.created_at} > claim ${new Date(live!.ts).toISOString()}`;
        }
      }
      const initiatedOnCall = !!initiated && now - initiated.ts <= CALL_WINDOW_MS;
      return {
        id: p.id,
        name: p.full_name ?? p.email ?? p.id,
        email: p.email,
        on_call: claimedOnCall || initiatedOnCall,
        claim_lead_id: live?.id ?? null,
        claim_stamp: live ? new Date(live.ts).toISOString() : null,
        initiated_lead_id: initiated?.id ?? null,
        initiated_stamp: initiated ? new Date(initiated.ts).toISOString() : null,
        last_active_at: p.last_active_at,
        reasons: [
          claimedOnCall
            ? `fresh undisposed claim on ${live!.id}`
            : null,
          initiatedOnCall ? `initiated call on ${initiated!.id}` : null,
          movedOnReason ? `claim invalidated: ${movedOnReason}` : null,
        ].filter(Boolean) as string[],
      };
    });
    const onCallCount = perAgent.filter((a) => a.on_call).length;
    push(`step 7: final on_call count=${onCallCount} of ${perAgent.length}`);

    return {
      generated_at: new Date().toISOString(),
      config: {
        ON_CALL_MAX_AGE_MS,
        CALL_WINDOW_MS,
        onCallSinceIso,
        callSinceIso,
      },
      log,
      counts: {
        sales_admin_ids: ids.length,
        leads_rows: leadsRows.length,
        list_leads_rows: listRows.length,
        recent_activities: recentActivity?.length ?? 0,
        on_call: onCallCount,
        agents: perAgent.length,
      },
      agents: perAgent
        .sort((a, b) => Number(b.on_call) - Number(a.on_call) || a.name.localeCompare(b.name)),
      side_traces_sample: sideTraces
        .sort((a, b) => (b.stamp ?? "").localeCompare(a.stamp ?? ""))
        .slice(0, 50),
      side_traces_total: sideTraces.length,
    };
  });
