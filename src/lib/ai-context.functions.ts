import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (error || !data) throw new Error("Forbidden — admins only");
}

export const listAiConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data } = await context.supabase
      .from("ai_conversations")
      .select("id, title, context_kind, context_id, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    return data ?? [];
  });

export const getAiConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: conv } = await context.supabase.from("ai_conversations").select("*").eq("id", data.id).maybeSingle();
    const { data: msgs } = await context.supabase.from("ai_messages").select("*").eq("conversation_id", data.id).order("created_at");
    return { conversation: conv, messages: msgs ?? [] };
  });

export const createAiConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { title?: string; context_kind?: string; context_id?: string | null }) =>
    z.object({
      title: z.string().max(120).optional(),
      context_kind: z.enum(["global", "lead", "agent", "vendor", "dashboard"]).optional(),
      context_id: z.string().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: conv, error } = await context.supabase
      .from("ai_conversations")
      .insert({
        owner_id: context.userId,
        title: data.title ?? "New conversation",
        context_kind: data.context_kind ?? "global",
        context_id: data.context_id ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return conv;
  });

export const deleteAiConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("ai_conversations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getAiSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data } = await context.supabase.from("ai_settings").select("*").eq("id", 1).maybeSingle();
    return data ?? { id: 1, monthly_auto_goal: 200, close_rate_target: 0.1 };
  });

export const updateAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { monthly_auto_goal: number; close_rate_target: number }) =>
    z.object({
      monthly_auto_goal: z.number().int().min(0).max(100000),
      close_rate_target: z.number().min(0).max(1),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("ai_settings")
      .update({ monthly_auto_goal: data.monthly_auto_goal, close_rate_target: data.close_rate_target, updated_by: context.userId, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getAiPinnedInsights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data } = await context.supabase
      .from("ai_pinned_insights")
      .select("*")
      .order("pinned_at", { ascending: false })
      .limit(20);
    return data ?? [];
  });

export const getAiAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data } = await context.supabase
      .from("ai_alerts")
      .select("*")
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(10);
    return data ?? [];
  });