import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// =================== TASKS ===================

const TaskInput = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid().optional().nullable(),
  leadId: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(500),
  description: z.string().max(4000).optional().nullable(),
  assignee: z.string().uuid().optional().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  dueAt: z.string().datetime().optional().nullable(),
});

export const createChatTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof TaskInput>) => TaskInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: row, error } = await supabaseAdmin
      .from("chat_tasks")
      .insert({
        conversation_id: data.conversationId,
        message_id: data.messageId ?? null,
        lead_id: data.leadId ?? null,
        title: data.title,
        description: data.description ?? null,
        assignee: data.assignee ?? null,
        priority: data.priority ?? "normal",
        due_at: data.dueAt ?? null,
        created_by: userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { task: row };
  });

export const listChatTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId: string }) =>
    z.object({ conversationId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { data: tasks, error } = await supabaseAdmin
      .from("chat_tasks")
      .select("*")
      .eq("conversation_id", data.conversationId)
      .order("status", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = Array.from(new Set((tasks ?? []).flatMap((t) => [t.assignee, t.created_by]).filter(Boolean) as string[]));
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const pmap = new Map((profs ?? []).map((p) => [p.id, p]));
    return {
      tasks: (tasks ?? []).map((t) => ({
        ...t,
        assignee_profile: t.assignee ? pmap.get(t.assignee) ?? null : null,
        creator_profile: pmap.get(t.created_by) ?? null,
      })),
    };
  });

export const updateChatTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status?: "open" | "done"; title?: string; dueAt?: string | null; assignee?: string | null; priority?: "low" | "normal" | "high" | "urgent" }) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["open", "done"]).optional(),
      title: z.string().min(1).max(500).optional(),
      dueAt: z.string().datetime().nullable().optional(),
      assignee: z.string().uuid().nullable().optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const patch: {
      status?: "open" | "done";
      completed_at?: string | null;
      title?: string;
      due_at?: string | null;
      assignee?: string | null;
      priority?: "low" | "normal" | "high" | "urgent";
    } = {};
    if (data.status !== undefined) {
      patch.status = data.status;
      patch.completed_at = data.status === "done" ? new Date().toISOString() : null;
    }
    if (data.title !== undefined) patch.title = data.title;
    if (data.dueAt !== undefined) patch.due_at = data.dueAt;
    if (data.assignee !== undefined) patch.assignee = data.assignee;
    if (data.priority !== undefined) patch.priority = data.priority;
    const { error } = await supabaseAdmin.from("chat_tasks").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteChatTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("chat_tasks")
      .delete()
      .eq("id", data.id)
      .eq("created_by", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// =================== LEAD TIMELINE ===================

export const pinMessageToLeadTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageId: string; leadId: string }) =>
    z.object({ messageId: z.string().uuid(), leadId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: msg } = await supabaseAdmin
      .from("chat_messages")
      .select("id, body, sender_id, conversation_id, created_at")
      .eq("id", data.messageId)
      .single();
    if (!msg) throw new Error("Message not found");
    await supabaseAdmin.from("lead_activities").insert({
      lead_id: data.leadId,
      lead_table: "leads",
      user_id: userId,
      action: "chat_pin",
      details: {
        message_id: msg.id,
        conversation_id: msg.conversation_id,
        body: (msg.body ?? "").slice(0, 500),
        sender_id: msg.sender_id,
        created_at: msg.created_at,
      },
    });
    return { ok: true };
  });

export const addMessageNoteToLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageId: string; leadId: string; note?: string }) =>
    z.object({
      messageId: z.string().uuid(),
      leadId: z.string().uuid(),
      note: z.string().max(2000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: msg } = await supabaseAdmin
      .from("chat_messages")
      .select("body, sender_id, conversation_id")
      .eq("id", data.messageId)
      .single();
    await supabaseAdmin.from("lead_activities").insert({
      lead_id: data.leadId,
      lead_table: "leads",
      user_id: userId,
      action: "chat_note",
      details: {
        message_id: data.messageId,
        conversation_id: msg?.conversation_id ?? null,
        body: data.note ?? (msg?.body ?? "").slice(0, 500),
        sender_id: msg?.sender_id ?? null,
      },
    });
    return { ok: true };
  });

// =================== TEMPLATES ===================

export const listChatTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data, error } = await supabaseAdmin
      .from("chat_templates")
      .select("*")
      .or(`owner.eq.${userId},is_shared.eq.true,owner.is.null`)
      .order("is_shared", { ascending: false })
      .order("title");
    if (error) throw new Error(error.message);
    return { templates: data ?? [] };
  });

export const createChatTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { title: string; body: string; isShared?: boolean }) =>
    z.object({
      title: z.string().min(1).max(200),
      body: z.string().min(1).max(4000),
      isShared: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await supabaseAdmin
      .from("chat_templates")
      .insert({
        owner: context.userId,
        title: data.title,
        body: data.body,
        is_shared: data.isShared ?? false,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { template: row };
  });

// =================== ANNOUNCEMENT FLAGS ===================

export const setAnnouncementFlags = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageId: string; isHighPriority?: boolean; requiresAck?: boolean; isPinnedAnnouncement?: boolean }) =>
    z.object({
      messageId: z.string().uuid(),
      isHighPriority: z.boolean().optional(),
      requiresAck: z.boolean().optional(),
      isPinnedAnnouncement: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const patch: {
      is_high_priority?: boolean;
      requires_ack?: boolean;
      is_pinned_announcement?: boolean;
    } = {};
    if (data.isHighPriority !== undefined) patch.is_high_priority = data.isHighPriority;
    if (data.requiresAck !== undefined) patch.requires_ack = data.requiresAck;
    if (data.isPinnedAnnouncement !== undefined) patch.is_pinned_announcement = data.isPinnedAnnouncement;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin.from("chat_messages").update(patch).eq("id", data.messageId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getAnnouncementAckStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageId: string }) => z.object({ messageId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: msg } = await supabaseAdmin
      .from("chat_messages")
      .select("conversation_id")
      .eq("id", data.messageId)
      .single();
    if (!msg) return { acknowledged: 0, total: 0 };
    const [{ count: ackCount }, { count: total }] = await Promise.all([
      supabaseAdmin.from("chat_announcement_acks").select("*", { count: "exact", head: true }).eq("message_id", data.messageId),
      supabaseAdmin.from("chat_conversation_members").select("*", { count: "exact", head: true }).eq("conversation_id", msg.conversation_id),
    ]);
    return { acknowledged: ackCount ?? 0, total: total ?? 0 };
  });

// =================== GLOBAL SEARCH ===================

export const globalChatSearch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { q: string }) => z.object({ q: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const q = data.q.trim();
    const like = `%${q}%`;

    const [people, convs, msgs, files, leads] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, avatar_url")
        .or(`full_name.ilike.${like},email.ilike.${like}`)
        .neq("id", userId)
        .limit(8),
      supabaseAdmin
        .from("chat_conversations")
        .select("id, name, type, is_private, chat_conversation_members!inner(user_id)")
        .eq("chat_conversation_members.user_id", userId)
        .ilike("name", like)
        .limit(8),
      supabaseAdmin
        .from("chat_messages")
        .select("id, conversation_id, body, sender_id, created_at, chat_conversations!inner(name, type, chat_conversation_members!inner(user_id))")
        .eq("chat_conversations.chat_conversation_members.user_id", userId)
        .ilike("body", like)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(10),
      supabaseAdmin
        .from("chat_attachments")
        .select("id, file_name, file_type, message_id, chat_messages!inner(conversation_id, chat_conversations!inner(name, chat_conversation_members!inner(user_id)))")
        .eq("chat_messages.chat_conversations.chat_conversation_members.user_id", userId)
        .ilike("file_name", like)
        .limit(6),
      supabaseAdmin
        .from("leads")
        .select("id, first_name, last_name, phone, email, dispo")
        .or(`first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
        .limit(8),
    ]);

    return {
      people: (people.data ?? []).map((p) => ({
        id: p.id,
        name: p.full_name ?? p.email ?? "Teammate",
        email: p.email,
        avatar_url: p.avatar_url,
      })),
      conversations: (convs.data ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        is_private: c.is_private,
      })),
      messages: (msgs.data ?? []).map((m) => ({
        id: m.id,
        conversation_id: m.conversation_id,
        conversation_name: m.chat_conversations?.name ?? "Conversation",
        body: m.body ?? "",
        created_at: m.created_at,
      })),
      files: (files.data ?? []).map((f) => ({
        id: f.id,
        file_name: f.file_name,
        file_type: f.file_type,
        message_id: f.message_id,
        conversation_id: f.chat_messages?.conversation_id ?? null,
        conversation_name: f.chat_messages?.chat_conversations?.name ?? "Conversation",
      })),
      leads: (leads.data ?? []).map((l) => ({
        id: l.id,
        name: [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email || l.phone || "Lead",
        phone: l.phone,
        email: l.email,
        dispo: l.dispo,
      })),
    };
  });

// =================== RELATED LEADS DETAILS ===================

export const getRelatedLeadsForConversation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId: string }) =>
    z.object({ conversationId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { data: rows } = await supabaseAdmin
      .from("chat_lead_conversations")
      .select("lead_id")
      .eq("conversation_id", data.conversationId);
    const ids = Array.from(new Set((rows ?? []).map((r) => r.lead_id)));
    if (!ids.length) return { leads: [] };
    const { data: leads } = await supabaseAdmin
      .from("leads")
      .select("id, first_name, last_name, phone, email, dispo, agent_id, updated_at")
      .in("id", ids);
    const agentIds = Array.from(new Set((leads ?? []).map((l) => l.agent_id).filter(Boolean) as string[]));
    const { data: agents } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", agentIds.length ? agentIds : ["00000000-0000-0000-0000-000000000000"]);
    const amap = new Map((agents ?? []).map((a) => [a.id, a]));
    return {
      leads: (leads ?? []).map((l) => ({
        id: l.id,
        name: [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email || l.phone || "Lead",
        phone: l.phone,
        email: l.email,
        dispo: l.dispo,
        last_activity_at: l.updated_at,
        owner: l.agent_id ? amap.get(l.agent_id) ?? null : null,
      })),
    };
  });

// =================== PINNED MESSAGES ===================

export const listPinnedMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId: string }) =>
    z.object({ conversationId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { data: pins } = await supabaseAdmin
      .from("chat_pinned_messages")
      .select("id, message_id, created_at, pinned_by")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: false });
    const mids = (pins ?? []).map((p) => p.message_id);
    if (!mids.length) return { pins: [] };
    const { data: msgs } = await supabaseAdmin
      .from("chat_messages")
      .select("id, body, sender_id, created_at")
      .in("id", mids);
    const sids = Array.from(new Set((msgs ?? []).map((m) => m.sender_id).filter((s): s is string => !!s)));
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", sids.length ? sids : ["00000000-0000-0000-0000-000000000000"]);
    const pmap = new Map((profs ?? []).map((p) => [p.id, p]));
    const mmap = new Map((msgs ?? []).map((m) => [m.id, m]));
    return {
      pins: (pins ?? [])
        .map((p) => {
          const m = mmap.get(p.message_id);
          if (!m) return null;
          return {
            pin_id: p.id,
            message_id: m.id,
            body: m.body,
            created_at: m.created_at,
            sender: m.sender_id ? pmap.get(m.sender_id) ?? null : null,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    };
  });