import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Post an announcement message to an announcement-type channel (admins/managers only). */
export const postAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId: string; title: string; body: string; requireAck?: boolean }) =>
    z
      .object({
        conversationId: z.string().uuid(),
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(8000),
        requireAck: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // permission: admin OR member with role owner/admin
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (meRoles ?? []).some((r) => r.role === "admin");

    const { data: mem } = await supabaseAdmin
      .from("chat_conversation_members")
      .select("role")
      .eq("conversation_id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    const channelAdmin = mem?.role === "owner" || mem?.role === "admin";
    if (!isAdmin && !channelAdmin) throw new Error("Only admins can post announcements");

    const composedBody = `**${data.title}**\n\n${data.body}${data.requireAck ? "\n\n_Acknowledgement required._" : ""}`;

    const { data: msg, error } = await supabaseAdmin
      .from("chat_messages")
      .insert({
        conversation_id: data.conversationId,
        sender_id: userId,
        body: composedBody,
        message_type: "announcement",
      })
      .select("id, created_at")
      .single();
    if (error) throw new Error(error.message);

    // notify all channel members via mentions of type 'channel'
    if (data.requireAck) {
      const { data: members } = await supabaseAdmin
        .from("chat_conversation_members")
        .select("user_id")
        .eq("conversation_id", data.conversationId);
      if (members?.length) {
        await supabaseAdmin.from("chat_message_mentions").insert(
          members
            .filter((m) => m.user_id !== userId)
            .map((m) => ({
              message_id: msg.id,
              conversation_id: data.conversationId,
              mentioned_user_id: m.user_id,
              mention_type: "channel" as const,
            })),
        );
      }
    }

    return { id: msg.id, created_at: msg.created_at };
  });

/** Mark an announcement as acknowledged by the current user. */
export const ackAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageId: string }) => z.object({ messageId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await supabaseAdmin
      .from("chat_announcement_acks")
      .upsert({ message_id: data.messageId, user_id: userId }, { onConflict: "message_id,user_id" });
    return { ok: true };
  });

/** List who has acknowledged an announcement (visible to channel members). */
export const listAnnouncementAcks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageId: string }) => z.object({ messageId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: acks } = await supabaseAdmin
      .from("chat_announcement_acks")
      .select("user_id, acknowledged_at")
      .eq("message_id", data.messageId);
    const ids = (acks ?? []).map((a) => a.user_id);
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const profMap = new Map(profs?.map((p) => [p.id, p]) ?? []);
    return {
      acks: (acks ?? []).map((a) => ({
        user_id: a.user_id,
        acknowledged_at: a.acknowledged_at,
        name: profMap.get(a.user_id)?.full_name ?? profMap.get(a.user_id)?.email ?? "Teammate",
      })),
    };
  });

/** Get current user's unread mention count + recent mentions. */
export const listMyMentions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data: rows } = await supabaseAdmin
      .from("chat_message_mentions")
      .select("id, message_id, conversation_id, read_at, created_at, mention_type")
      .eq("mentioned_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    const mids = (rows ?? []).map((r) => r.message_id);
    const { data: msgs } = await supabaseAdmin
      .from("chat_messages")
      .select("id, body, sender_id, conversation_id, created_at")
      .in("id", mids.length ? mids : ["00000000-0000-0000-0000-000000000000"]);
    const { data: convs } = await supabaseAdmin
      .from("chat_conversations")
      .select("id, name, type")
      .in("id", Array.from(new Set((rows ?? []).map((r) => r.conversation_id))));
    const senderIds = Array.from(new Set((msgs ?? []).map((m) => m.sender_id).filter(Boolean) as string[]));
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", senderIds.length ? senderIds : ["00000000-0000-0000-0000-000000000000"]);
    const msgMap = new Map(msgs?.map((m) => [m.id, m]) ?? []);
    const convMap = new Map(convs?.map((c) => [c.id, c]) ?? []);
    const profMap = new Map(profs?.map((p) => [p.id, p]) ?? []);
    const unread = (rows ?? []).filter((r) => !r.read_at).length;
    return {
      unread,
      mentions: (rows ?? []).map((r) => {
        const m = msgMap.get(r.message_id);
        const c = convMap.get(r.conversation_id);
        const p = m?.sender_id ? profMap.get(m.sender_id) : null;
        return {
          id: r.id,
          message_id: r.message_id,
          conversation_id: r.conversation_id,
          conversation_name: c?.name ?? "Conversation",
          conversation_type: c?.type ?? "channel",
          body: m?.body ?? "",
          sender_name: p?.full_name ?? p?.email ?? "Teammate",
          created_at: r.created_at,
          read_at: r.read_at,
          mention_type: r.mention_type,
        };
      }),
    };
  });

/** Mark all of the current user's mentions as read. */
export const markMentionsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId?: string | null }) =>
    z.object({ conversationId: z.string().uuid().nullable().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    let q = supabaseAdmin
      .from("chat_message_mentions")
      .update({ read_at: new Date().toISOString() })
      .eq("mentioned_user_id", userId)
      .is("read_at", null);
    if (data.conversationId) q = q.eq("conversation_id", data.conversationId);
    await q;
    return { ok: true };
  });

/** List replies in a thread (children of parent_message_id). */
export const listThreadReplies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { parentMessageId: string }) =>
    z.object({ parentMessageId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: parent } = await supabaseAdmin
      .from("chat_messages")
      .select("id, conversation_id, body, sender_id, created_at, edited_at, deleted_at")
      .eq("id", data.parentMessageId)
      .maybeSingle();
    if (!parent) throw new Error("Parent message not found");

    const { data: isMem } = await supabaseAdmin.rpc("chat_is_member", {
      _conv: parent.conversation_id,
      _user: userId,
    });
    if (!isMem) throw new Error("Not a member");

    const { data: rows } = await supabaseAdmin
      .from("chat_messages")
      .select("id, conversation_id, sender_id, body, message_type, edited_at, deleted_at, created_at, parent_message_id")
      .eq("parent_message_id", data.parentMessageId)
      .order("created_at", { ascending: true });

    const senderIds = Array.from(
      new Set([parent.sender_id, ...(rows ?? []).map((r) => r.sender_id)].filter(Boolean) as string[]),
    );
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", senderIds.length ? senderIds : ["00000000-0000-0000-0000-000000000000"]);
    const profMap = new Map(profs?.map((p) => [p.id, p]) ?? []);
    const decorate = (m: { sender_id: string | null }) => {
      const p = m.sender_id ? profMap.get(m.sender_id) : null;
      return {
        sender_name: p?.full_name ?? p?.email ?? "Unknown",
        sender_avatar: p?.avatar_url ?? null,
      };
    };
    return {
      parent: { ...parent, ...decorate(parent) },
      replies: (rows ?? []).map((r) => ({ ...r, ...decorate(r) })),
    };
  });

/** Get thread reply counts for a list of parent message ids. */
export const getThreadCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageIds: string[] }) =>
    z.object({ messageIds: z.array(z.string().uuid()).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    if (!data.messageIds.length) return { counts: {} as Record<string, number> };
    const { data: rows } = await supabaseAdmin
      .from("chat_messages")
      .select("parent_message_id")
      .in("parent_message_id", data.messageIds)
      .is("deleted_at", null);
    const counts: Record<string, number> = {};
    for (const r of rows ?? []) {
      if (!r.parent_message_id) continue;
      counts[r.parent_message_id] = (counts[r.parent_message_id] ?? 0) + 1;
    }
    return { counts };
  });

/** Full-text search across messages the user can see. */
export const searchMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { q: string; conversationId?: string | null }) =>
    z
      .object({
        q: z.string().min(1).max(200),
        conversationId: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: memberships } = await supabaseAdmin
      .from("chat_conversation_members")
      .select("conversation_id")
      .eq("user_id", userId);
    const allowed = (memberships ?? []).map((m) => m.conversation_id);
    if (!allowed.length) return { results: [] };

    const ids = data.conversationId ? allowed.filter((id) => id === data.conversationId) : allowed;
    if (!ids.length) return { results: [] };

    const { data: rows, error } = await supabaseAdmin
      .from("chat_messages")
      .select("id, conversation_id, body, sender_id, created_at")
      .in("conversation_id", ids)
      .is("deleted_at", null)
      .ilike("body", `%${data.q.replace(/[%_]/g, " ")}%`)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);

    const senderIds = Array.from(new Set((rows ?? []).map((r) => r.sender_id).filter(Boolean) as string[]));
    const convIds = Array.from(new Set((rows ?? []).map((r) => r.conversation_id)));
    const [{ data: profs }, { data: convs }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", senderIds.length ? senderIds : ["00000000-0000-0000-0000-000000000000"]),
      supabaseAdmin
        .from("chat_conversations")
        .select("id, name, type")
        .in("id", convIds.length ? convIds : ["00000000-0000-0000-0000-000000000000"]),
    ]);
    const profMap = new Map(profs?.map((p) => [p.id, p]) ?? []);
    const convMap = new Map(convs?.map((c) => [c.id, c]) ?? []);

    return {
      results: (rows ?? []).map((r) => {
        const p = r.sender_id ? profMap.get(r.sender_id) : null;
        const c = convMap.get(r.conversation_id);
        return {
          id: r.id,
          conversation_id: r.conversation_id,
          conversation_name: c?.name ?? "Conversation",
          conversation_type: c?.type ?? "channel",
          body: r.body ?? "",
          sender_name: p?.full_name ?? p?.email ?? "Teammate",
          created_at: r.created_at,
        };
      }),
    };
  });

/** Get or create a chat conversation linked to a lead. */
export const getOrCreateLeadConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { leadId: string; leadName?: string }) =>
    z.object({ leadId: z.string().uuid(), leadName: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: existing } = await supabaseAdmin
      .from("chat_lead_conversations")
      .select("conversation_id")
      .eq("lead_id", data.leadId)
      .limit(1)
      .maybeSingle();
    if (existing) {
      // make sure caller is a member
      const { data: isMem } = await supabaseAdmin.rpc("chat_is_member", {
        _conv: existing.conversation_id,
        _user: userId,
      });
      if (!isMem) {
        await supabaseAdmin.from("chat_conversation_members").insert({
          conversation_id: existing.conversation_id,
          user_id: userId,
          role: "member",
        });
      }
      return { id: existing.conversation_id, created: false };
    }

    const name = (data.leadName ?? "lead")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "lead";

    const { data: conv, error } = await supabaseAdmin
      .from("chat_conversations")
      .insert({
        name: `lead-${name}`,
        type: "group_dm",
        is_private: true,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("chat_conversation_members").insert({
      conversation_id: conv.id,
      user_id: userId,
      role: "owner",
    });
    await supabaseAdmin.from("chat_lead_conversations").insert({
      lead_id: data.leadId,
      conversation_id: conv.id,
      created_by: userId,
    });
    // seed system message
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conv.id,
      sender_id: userId,
      body: `Lead discussion started for /leads/${data.leadId}`,
      message_type: "system",
    });
    return { id: conv.id, created: true };
  });

/** Share a lead reference into an existing conversation as a message. */
export const shareLeadToConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { leadId: string; conversationId: string; note?: string }) =>
    z
      .object({
        leadId: z.string().uuid(),
        conversationId: z.string().uuid(),
        note: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: isMem } = await supabaseAdmin.rpc("chat_is_member", {
      _conv: data.conversationId,
      _user: userId,
    });
    if (!isMem) throw new Error("Not a member of this conversation");
    const body = `${data.note ? data.note + "\n\n" : ""}Lead: /leads/${data.leadId}`;
    const { error } = await supabaseAdmin.from("chat_messages").insert({
      conversation_id: data.conversationId,
      sender_id: userId,
      body,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Set custom status (emoji + text + optional clear time). */
export const setCustomStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { emoji?: string | null; text?: string | null; clearInMinutes?: number | null }) =>
    z
      .object({
        emoji: z.string().max(8).nullable().optional(),
        text: z.string().max(140).nullable().optional(),
        clearInMinutes: z.number().int().positive().max(60 * 24 * 30).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const clearAt = data.clearInMinutes
      ? new Date(Date.now() + data.clearInMinutes * 60 * 1000).toISOString()
      : null;
    await supabaseAdmin
      .from("user_presence")
      .upsert(
        {
          user_id: userId,
          status: "online",
          custom_status: data.text ?? null,
          status_emoji: data.emoji ?? null,
          status_clear_at: clearAt,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    return { ok: true };
  });

/** Admin: list all channels (including archived). */
export const adminListChannels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (!(meRoles ?? []).some((r) => r.role === "admin")) throw new Error("Forbidden");
    const { data: convs } = await supabaseAdmin
      .from("chat_conversations")
      .select("id, name, type, is_private, archived_at, created_at, last_message_at, created_by")
      .order("created_at", { ascending: false });
    const ids = (convs ?? []).map((c) => c.id);
    const { data: members } = await supabaseAdmin
      .from("chat_conversation_members")
      .select("conversation_id")
      .in("conversation_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const counts: Record<string, number> = {};
    for (const m of members ?? []) counts[m.conversation_id] = (counts[m.conversation_id] ?? 0) + 1;
    return {
      channels: (convs ?? []).map((c) => ({ ...c, member_count: counts[c.id] ?? 0 })),
    };
  });

/** Admin: archive (soft delete) a conversation. */
export const adminArchiveConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId: string; archive: boolean }) =>
    z.object({ conversationId: z.string().uuid(), archive: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (!(meRoles ?? []).some((r) => r.role === "admin")) throw new Error("Forbidden");
    await supabaseAdmin
      .from("chat_conversations")
      .update({ archived_at: data.archive ? new Date().toISOString() : null })
      .eq("id", data.conversationId);
    await supabaseAdmin.from("chat_audit_log").insert({
      actor_id: userId,
      action: data.archive ? "channel.archive" : "channel.unarchive",
      target_type: "conversation",
      target_id: data.conversationId,
      conversation_id: data.conversationId,
    });
    return { ok: true };
  });

/** Admin: read audit log. */
export const adminListAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (!(meRoles ?? []).some((r) => r.role === "admin")) throw new Error("Forbidden");
    const { data: rows } = await supabaseAdmin
      .from("chat_audit_log")
      .select("id, actor_id, action, target_type, target_id, conversation_id, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    const ids = Array.from(new Set((rows ?? []).map((r) => r.actor_id).filter(Boolean) as string[]));
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const profMap = new Map(profs?.map((p) => [p.id, p]) ?? []);
    return {
      entries: (rows ?? []).map((r) => ({
        ...r,
        actor_name: r.actor_id
          ? profMap.get(r.actor_id)?.full_name ?? profMap.get(r.actor_id)?.email ?? "Unknown"
          : "System",
      })),
    };
  });

/** Admin: remove a member from a conversation. */
export const adminRemoveMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId: string; userId: string }) =>
    z.object({ conversationId: z.string().uuid(), userId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (!(meRoles ?? []).some((r) => r.role === "admin")) throw new Error("Forbidden");
    await supabaseAdmin
      .from("chat_conversation_members")
      .delete()
      .eq("conversation_id", data.conversationId)
      .eq("user_id", data.userId);
    await supabaseAdmin.from("chat_audit_log").insert({
      actor_id: userId,
      action: "member.remove",
      target_type: "user",
      target_id: data.userId,
      conversation_id: data.conversationId,
    });
    return { ok: true };
  });

/**
 * Search Klipy for GIFs. Requires KLIPY_API_KEY env var.
 * Returns small/preview URLs for the picker grid and a full URL for sending.
 */
export const gifSearch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { query: string; limit?: number }) =>
    z
      .object({
        query: z.string().max(120).default(""),
        limit: z.number().int().min(1).max(40).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const key = process.env.KLIPY_API_KEY;
    if (!key) {
      return { configured: false as const, results: [] as Array<{ id: string; preview: string; url: string; alt: string }> };
    }
    const limit = Math.max(8, Math.min(50, data.limit ?? 24));
    const customerId = encodeURIComponent(context.userId);
    const q = data.query.trim();
    const base = `https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs`;
    const common = `per_page=${limit}&customer_id=${customerId}&content_filter=high&format_filter=gif`;
    const endpoint = q
      ? `${base}/search?q=${encodeURIComponent(q)}&page=1&${common}`
      : `${base}/trending?page=1&${common}`;
    const res = await fetch(endpoint);
    if (!res.ok) {
      throw new Error(`Klipy error ${res.status}`);
    }
    type KlipyFormat = { url: string; width?: number; height?: number };
    type KlipySize = { gif?: KlipyFormat; webp?: KlipyFormat };
    type KlipyItem = {
      id: number | string;
      slug?: string;
      title?: string;
      file?: { hd?: KlipySize; md?: KlipySize; sm?: KlipySize; xs?: KlipySize };
    };
    const json = (await res.json()) as {
      result?: boolean;
      data?: { data?: KlipyItem[] };
    };
    const items = json.data?.data ?? [];
    const results = items.map((r) => {
      const previewUrl =
        r.file?.sm?.gif?.url ?? r.file?.xs?.gif?.url ?? r.file?.md?.gif?.url ?? "";
      const fullUrl =
        r.file?.md?.gif?.url ?? r.file?.hd?.gif?.url ?? r.file?.sm?.gif?.url ?? "";
      return {
        id: String(r.id ?? r.slug ?? ""),
        preview: previewUrl || fullUrl,
        url: fullUrl || previewUrl,
        alt: r.title ?? "GIF",
      };
    }).filter((r) => r.url);
    return { configured: true as const, results };
  });
