import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Chat permission matrix:
 *  - admin           → anyone
 *  - sales ↔ sales   → allow (unless one side is a vendor account)
 *  - vendor ↔ sales  → allow ONLY if the sales user is the vendor's own sub-agent
 *                      (profiles.parent_vendor_id === vendor.id)
 *  - vendor ↔ vendor → deny
 *  - telemarketer    → admin only
 *  - anyone else     → admin only
 */
export type ChatProfile = {
  id: string;
  roles: string[];
  parent_vendor_id: string | null;
};

function isVendor(p: ChatProfile) {
  return p.roles.includes("vendor");
}

function canChatBetween(a: ChatProfile, b: ChatProfile): boolean {
  if (a.roles.includes("admin") || b.roles.includes("admin")) return true;

  const aVendor = isVendor(a);
  const bVendor = isVendor(b);

  if (aVendor && bVendor) return false;

  if (aVendor || bVendor) {
    const vendor = aVendor ? a : b;
    const other = aVendor ? b : a;
    if (!other.roles.includes("sales")) return false;
    return other.parent_vendor_id === vendor.id;
  }

  if (a.roles.includes("sales") && b.roles.includes("sales")) return true;
  return false;
}

/** Fetch roles + parent_vendor_id keyed by user_id for the given set of user ids. */
async function getChatProfileMap(userIds: string[]): Promise<Map<string, ChatProfile>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const [{ data: roleRows, error: rErr }, { data: profRows, error: pErr }] = await Promise.all([
    supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
    supabaseAdmin.from("profiles").select("id, parent_vendor_id").in("id", ids),
  ]);
  if (rErr) throw new Error(rErr.message);
  if (pErr) throw new Error(pErr.message);
  const map = new Map<string, ChatProfile>();
  for (const id of ids) map.set(id, { id, roles: [], parent_vendor_id: null });
  for (const r of roleRows ?? []) {
    const p = map.get(r.user_id);
    if (p) p.roles.push(r.role as string);
  }
  for (const pr of profRows ?? []) {
    const p = map.get(pr.id);
    if (p) p.parent_vendor_id = (pr as { parent_vendor_id: string | null }).parent_vendor_id ?? null;
  }
  return map;
}

function getChatProfile(map: Map<string, ChatProfile>, id: string): ChatProfile {
  return map.get(id) ?? { id, roles: [], parent_vendor_id: null };
}

/** Convenience: list all conversations the user belongs to, with member + last-message info. */
export const listMyConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;

    const { data: memberships, error: memErr } = await supabaseAdmin
      .from("chat_conversation_members")
      .select("conversation_id, last_read_at, muted, notification_level, role")
      .eq("user_id", userId);
    if (memErr) throw new Error(memErr.message);

    const convIds = (memberships ?? []).map((m) => m.conversation_id);
    if (convIds.length === 0) return { conversations: [] as ConversationSummary[] };

    const { data: convs, error: cErr } = await supabaseAdmin
      .from("chat_conversations")
      .select("id, name, type, is_private, created_by, created_at, last_message_at")
      .in("id", convIds)
      .is("archived_at", null)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (cErr) throw new Error(cErr.message);

    // last message body per conversation (one query, then map client-side)
    const { data: lastMsgs } = await supabaseAdmin
      .from("chat_messages")
      .select("id, conversation_id, sender_id, body, message_type, created_at")
      .in("conversation_id", convIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500);
    const lastByConv = new Map<string, { body: string | null; created_at: string; sender_id: string | null }>();
    for (const m of lastMsgs ?? []) {
      if (!lastByConv.has(m.conversation_id)) {
        lastByConv.set(m.conversation_id, {
          body: m.body,
          created_at: m.created_at as string,
          sender_id: m.sender_id,
        });
      }
    }

    // unread counts: messages after last_read_at, excluding own
    const memMap = new Map(memberships?.map((m) => [m.conversation_id, m]) ?? []);
    const unreadByConv = new Map<string, number>();
    for (const m of lastMsgs ?? []) {
      const mem = memMap.get(m.conversation_id);
      if (!mem) continue;
      if (m.sender_id === userId) continue;
      if (mem.last_read_at && new Date(m.created_at as string) <= new Date(mem.last_read_at)) continue;
      unreadByConv.set(m.conversation_id, (unreadByConv.get(m.conversation_id) ?? 0) + 1);
    }

    // For DMs: surface the other user's profile so the UI can render their name/avatar
    const dmIds = (convs ?? []).filter((c) => c.type === "dm").map((c) => c.id);
    const otherUserByConv = new Map<string, { id: string; name: string | null; avatar: string | null }>();
    if (dmIds.length) {
      const { data: dmMembers } = await supabaseAdmin
        .from("chat_conversation_members")
        .select("conversation_id, user_id")
        .in("conversation_id", dmIds);
      const others = (dmMembers ?? []).filter((m) => m.user_id !== userId);
      const otherIds = Array.from(new Set(others.map((m) => m.user_id)));
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, avatar_url")
        .in("id", otherIds.length ? otherIds : ["00000000-0000-0000-0000-000000000000"]);
      const profMap = new Map(profs?.map((p) => [p.id, p]) ?? []);
      for (const m of others) {
        const p = profMap.get(m.user_id);
        otherUserByConv.set(m.conversation_id, {
          id: m.user_id,
          name: p?.full_name ?? p?.email ?? "Teammate",
          avatar: p?.avatar_url ?? null,
        });
      }
    }

    const conversations: ConversationSummary[] = (convs ?? []).map((c) => {
      const mem = memMap.get(c.id);
      const last = lastByConv.get(c.id);
      const other = otherUserByConv.get(c.id);
      return {
        id: c.id,
        name: c.name,
        type: c.type as ConversationSummary["type"],
        is_private: c.is_private,
        last_message_at: c.last_message_at as string | null,
        last_message_preview: last?.body ?? null,
        last_message_sender_id: last?.sender_id ?? null,
        unread_count: unreadByConv.get(c.id) ?? 0,
        muted: !!mem?.muted,
        my_role: (mem?.role as "owner" | "admin" | "member") ?? "member",
        last_read_at: (mem?.last_read_at as string) ?? null,
        other_user: other ?? null,
      };
    });

    return { conversations };
  });

export type ConversationSummary = {
  id: string;
  name: string | null;
  type: "channel" | "dm" | "group_dm" | "announcement";
  is_private: boolean;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_sender_id: string | null;
  unread_count: number;
  muted: boolean;
  my_role: "owner" | "admin" | "member";
  last_read_at: string | null;
  other_user: { id: string; name: string | null; avatar: string | null } | null;
};

/** Get a single conversation + members + pinned IDs. */
export const getConversation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId: string }) =>
    z.object({ conversationId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: isMem } = await supabaseAdmin.rpc("chat_is_member", {
      _conv: data.conversationId,
      _user: userId,
    });
    if (!isMem) throw new Error("Not a member of this conversation");

    const { data: conv, error } = await supabaseAdmin
      .from("chat_conversations")
      .select("id, name, type, is_private, created_by, created_at, last_message_at")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (error || !conv) throw new Error(error?.message ?? "Conversation not found");

    const { data: members } = await supabaseAdmin
      .from("chat_conversation_members")
      .select("user_id, role, joined_at, last_read_at")
      .eq("conversation_id", data.conversationId);

    const memberIds = (members ?? []).map((m) => m.user_id);
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"]);
    const { data: presence } = await supabaseAdmin
      .from("user_presence")
      .select("user_id, status, custom_status, last_seen_at")
      .in("user_id", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"]);
    const presMap = new Map(presence?.map((p) => [p.user_id, p]) ?? []);
    const profMap = new Map(profs?.map((p) => [p.id, p]) ?? []);

    const memberRows = (members ?? []).map((m) => {
      const p = profMap.get(m.user_id);
      const pres = presMap.get(m.user_id);
      return {
        user_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
        last_read_at: m.last_read_at,
        name: p?.full_name ?? p?.email ?? "Teammate",
        email: p?.email ?? null,
        avatar_url: p?.avatar_url ?? null,
        presence: (pres?.status as string | undefined) ?? "offline",
        custom_status: pres?.custom_status ?? null,
      };
    });

    const { data: pins } = await supabaseAdmin
      .from("chat_pinned_messages")
      .select("message_id, pinned_by, created_at")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: false });

    return { conversation: conv, members: memberRows, pinned: pins ?? [] };
  });

/** Paginated message history (newest-first, but returned ascending for easy rendering). */
export const listMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId: string; before?: string | null; limit?: number }) =>
    z
      .object({
        conversationId: z.string().uuid(),
        before: z.string().nullable().optional(),
        limit: z.number().int().min(1).max(100).optional(),
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

    const limit = data.limit ?? 50;
    let q = supabaseAdmin
      .from("chat_messages")
      .select("id, conversation_id, sender_id, body, parent_message_id, message_type, edited_at, deleted_at, created_at")
      .eq("conversation_id", data.conversationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (data.before) q = q.lt("created_at", data.before);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r) => r.id);
    const safeIds = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];
    const senderIds = Array.from(new Set((rows ?? []).map((r) => r.sender_id).filter(Boolean) as string[]));

    const [{ data: reactions }, { data: attachments }, { data: profs }] = await Promise.all([
      supabaseAdmin
        .from("chat_message_reactions")
        .select("message_id, user_id, emoji")
        .in("message_id", safeIds),
      supabaseAdmin
        .from("chat_attachments")
        .select("id, message_id, file_path, file_name, file_type, file_size")
        .in("message_id", safeIds),
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, avatar_url")
        .in("id", senderIds.length ? senderIds : ["00000000-0000-0000-0000-000000000000"]),
    ]);

    // sign attachment URLs
    const attWithUrls = await Promise.all(
      (attachments ?? []).map(async (a) => {
        const { data: signed } = await supabaseAdmin.storage
          .from("chat-attachments")
          .createSignedUrl(a.file_path, 60 * 60);
        return { ...a, signed_url: signed?.signedUrl ?? null };
      }),
    );

    const profMap = new Map(profs?.map((p) => [p.id, p]) ?? []);
    const reactionsByMsg = new Map<string, { emoji: string; user_id: string }[]>();
    for (const r of reactions ?? []) {
      const list = reactionsByMsg.get(r.message_id) ?? [];
      list.push({ emoji: r.emoji, user_id: r.user_id });
      reactionsByMsg.set(r.message_id, list);
    }
    const attachmentsByMsg = new Map<string, typeof attWithUrls>();
    for (const a of attWithUrls) {
      const list = attachmentsByMsg.get(a.message_id) ?? [];
      list.push(a);
      attachmentsByMsg.set(a.message_id, list);
    }

    const messages = (rows ?? [])
      .map((m) => {
        const p = m.sender_id ? profMap.get(m.sender_id) : null;
        return {
          ...m,
          sender_name: p?.full_name ?? p?.email ?? "Unknown",
          sender_avatar: p?.avatar_url ?? null,
          reactions: reactionsByMsg.get(m.id) ?? [],
          attachments: attachmentsByMsg.get(m.id) ?? [],
        };
      })
      .reverse();

    return { messages, has_more: (rows ?? []).length === limit };
  });

/** Send a message. Returns the inserted row. */
export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      conversationId: string;
      body: string;
      parentMessageId?: string | null;
      messageType?: "text" | "file" | "system" | "announcement";
      attachments?: { file_path: string; file_name: string; file_type?: string | null; file_size?: number | null }[];
      mentionUserIds?: string[];
      mentionEveryone?: boolean;
    }) =>
      z
        .object({
          conversationId: z.string().uuid(),
          body: z.string().max(8000),
          parentMessageId: z.string().uuid().nullable().optional(),
          messageType: z.enum(["text", "file", "system", "announcement"]).optional(),
          attachments: z
            .array(
              z.object({
                file_path: z.string(),
                file_name: z.string(),
                file_type: z.string().nullable().optional(),
                file_size: z.number().nullable().optional(),
              }),
            )
            .optional(),
          mentionUserIds: z.array(z.string().uuid()).optional(),
          mentionEveryone: z.boolean().optional(),
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

    if (!data.body.trim() && !(data.attachments?.length)) {
      throw new Error("Message is empty");
    }

    const { data: msg, error } = await supabaseAdmin
      .from("chat_messages")
      .insert({
        conversation_id: data.conversationId,
        sender_id: userId,
        body: data.body,
        parent_message_id: data.parentMessageId ?? null,
        message_type: data.messageType ?? (data.attachments?.length ? "file" : "text"),
      })
      .select("id, created_at")
      .single();
    if (error) throw new Error(error.message);

    if (data.attachments?.length) {
      const rows = data.attachments.map((a) => ({
        message_id: msg.id,
        conversation_id: data.conversationId,
        file_path: a.file_path,
        file_name: a.file_name,
        file_type: a.file_type ?? null,
        file_size: a.file_size ?? null,
        uploaded_by: userId,
      }));
      const { error: aErr } = await supabaseAdmin.from("chat_attachments").insert(rows);
      if (aErr) throw new Error(aErr.message);
    }

    // bump my last_read_at so my own message doesn't show as unread on other tabs
    await supabaseAdmin
      .from("chat_conversation_members")
      .update({ last_read_at: msg.created_at })
      .eq("conversation_id", data.conversationId)
      .eq("user_id", userId);

    // persist mentions
    const mentionUserIds = Array.from(new Set(data.mentionUserIds ?? []));
    if (mentionUserIds.length) {
      await supabaseAdmin.from("chat_message_mentions").insert(
        mentionUserIds
          .filter((u) => u !== userId)
          .map((u) => ({
            message_id: msg.id,
            conversation_id: data.conversationId,
            mentioned_user_id: u,
            mention_type: "user" as const,
          })),
      );
    }
    if (data.mentionEveryone) {
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

/** Toggle a reaction on a message. */
export const toggleReaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageId: string; emoji: string }) =>
    z.object({ messageId: z.string().uuid(), emoji: z.string().min(1).max(32) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: existing } = await supabaseAdmin
      .from("chat_message_reactions")
      .select("id")
      .eq("message_id", data.messageId)
      .eq("user_id", userId)
      .eq("emoji", data.emoji)
      .maybeSingle();
    if (existing) {
      await supabaseAdmin.from("chat_message_reactions").delete().eq("id", existing.id);
      return { added: false };
    }
    const { error } = await supabaseAdmin
      .from("chat_message_reactions")
      .insert({ message_id: data.messageId, user_id: userId, emoji: data.emoji });
    if (error) throw new Error(error.message);
    return { added: true };
  });

/** Edit own message body. */
export const editMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageId: string; body: string }) =>
    z.object({ messageId: z.string().uuid(), body: z.string().min(1).max(8000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { error } = await supabaseAdmin
      .from("chat_messages")
      .update({ body: data.body, edited_at: new Date().toISOString() })
      .eq("id", data.messageId)
      .eq("sender_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Soft-delete own message. */
export const deleteMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageId: string }) =>
    z.object({ messageId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    // allow admin override
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (meRoles ?? []).some((r) => r.role === "admin");
    let q = supabaseAdmin
      .from("chat_messages")
      .update({ deleted_at: new Date().toISOString(), body: null })
      .eq("id", data.messageId);
    if (!isAdmin) q = q.eq("sender_id", userId);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Pin / unpin a message. */
export const pinMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageId: string; conversationId: string; pin: boolean }) =>
    z
      .object({
        messageId: z.string().uuid(),
        conversationId: z.string().uuid(),
        pin: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    if (data.pin) {
      await supabaseAdmin
        .from("chat_pinned_messages")
        .upsert(
          { conversation_id: data.conversationId, message_id: data.messageId, pinned_by: userId },
          { onConflict: "conversation_id,message_id" },
        );
    } else {
      await supabaseAdmin
        .from("chat_pinned_messages")
        .delete()
        .eq("conversation_id", data.conversationId)
        .eq("message_id", data.messageId);
    }
    return { ok: true };
  });

/** Mark a conversation as read up to now. */
export const markRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId: string }) =>
    z.object({ conversationId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await supabaseAdmin
      .from("chat_conversation_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", data.conversationId)
      .eq("user_id", userId);
    return { ok: true };
  });

/** Search teammates by name/email for "+ New message" and @mentions. */
export const searchTeammates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { q?: string }) => z.object({ q: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const q = (data.q ?? "").trim();
    let query = supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .neq("id", userId)
      .order("full_name", { ascending: true })
      .limit(500);
    if (q) {
      query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    const profiles = rows ?? [];
    const profMap = await getChatProfileMap([userId, ...profiles.map((p) => p.id)]);
    const me = getChatProfile(profMap, userId);
    const allowed = profiles.filter((p) => canChatBetween(me, getChatProfile(profMap, p.id)));
    return { users: allowed.slice(0, 200) };
  });

/** Create or fetch an existing 1-on-1 DM with another user. */
export const createDM = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { otherUserId: string }) =>
    z.object({ otherUserId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    if (data.otherUserId === userId) throw new Error("Cannot DM yourself");

    const profMap = await getChatProfileMap([userId, data.otherUserId]);
    if (!canChatBetween(getChatProfile(profMap, userId), getChatProfile(profMap, data.otherUserId))) {
      throw new Error("You don't have permission to message this user");
    }

    // find existing DM where both users are members
    const { data: myDms } = await supabaseAdmin
      .from("chat_conversation_members")
      .select("conversation_id, chat_conversations!inner(type)")
      .eq("user_id", userId);
    const myDmIds = (myDms ?? [])
      .filter((r) => (r as { chat_conversations: { type: string } }).chat_conversations.type === "dm")
      .map((r) => r.conversation_id);
    if (myDmIds.length) {
      const { data: shared } = await supabaseAdmin
        .from("chat_conversation_members")
        .select("conversation_id")
        .eq("user_id", data.otherUserId)
        .in("conversation_id", myDmIds)
        .limit(1);
      if (shared && shared.length) {
        return { id: shared[0].conversation_id };
      }
    }

    const { data: conv, error: cErr } = await supabaseAdmin
      .from("chat_conversations")
      .insert({ type: "dm", is_private: true, created_by: userId, name: null })
      .select("id")
      .single();
    if (cErr) throw new Error(cErr.message);

    const { error: mErr } = await supabaseAdmin.from("chat_conversation_members").insert([
      { conversation_id: conv.id, user_id: userId, role: "owner" },
      { conversation_id: conv.id, user_id: data.otherUserId, role: "member" },
    ]);
    if (mErr) throw new Error(mErr.message);

    return { id: conv.id };
  });

/** Create a channel. */
export const createChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string; isPrivate?: boolean; memberIds?: string[]; announcement?: boolean }) =>
    z
      .object({
        name: z.string().min(1).max(80),
        isPrivate: z.boolean().optional(),
        memberIds: z.array(z.string().uuid()).optional(),
        announcement: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    // Only admins can create channels (regular or announcement).
    const { data: meRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (!(meRoles ?? []).some((r) => r.role === "admin")) {
      throw new Error("Only admins can create channels");
    }
    const cleanName = data.name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    if (!cleanName) throw new Error("Invalid channel name");

    const memberIds = data.memberIds ?? [];
    if (memberIds.length) {
      const profMap = await getChatProfileMap([userId, ...memberIds]);
      const me = getChatProfile(profMap, userId);
      const blocked = memberIds.find(
        (id) => !canChatBetween(me, getChatProfile(profMap, id)),
      );
      if (blocked) throw new Error("You don't have permission to add one or more of these members");
    }

    const { data: conv, error } = await supabaseAdmin
      .from("chat_conversations")
      .insert({
        name: cleanName,
        type: data.announcement ? "announcement" : "channel",
        is_private: !!data.isPrivate,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const memberRows = [
      { conversation_id: conv.id, user_id: userId, role: "owner" as const },
      ...(data.memberIds ?? []).map((id) => ({
        conversation_id: conv.id,
        user_id: id,
        role: "member" as const,
      })),
    ];
    await supabaseAdmin.from("chat_conversation_members").insert(memberRows);

    return { id: conv.id };
  });

/** Create a group DM with 2–9 other members. Always creates a new conversation. */
export const createGroupDM = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userIds: string[]; name?: string }) =>
    z
      .object({
        userIds: z.array(z.string().uuid()).min(2).max(50),
        name: z.string().max(80).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const others = Array.from(new Set(data.userIds)).filter((id) => id !== userId);
    if (others.length < 2) throw new Error("Pick at least 2 other teammates");

    const profMap = await getChatProfileMap([userId, ...others]);
    const me = getChatProfile(profMap, userId);
    const blocked = others.find((id) => !canChatBetween(me, getChatProfile(profMap, id)));
    if (blocked) throw new Error("You don't have permission to add one or more of these members");

    const { data: conv, error: cErr } = await supabaseAdmin
      .from("chat_conversations")
      .insert({
        type: "group_dm",
        is_private: true,
        created_by: userId,
        name: data.name?.trim() || null,
      })
      .select("id")
      .single();
    if (cErr) throw new Error(cErr.message);

    const rows = [
      { conversation_id: conv.id, user_id: userId, role: "owner" as const },
      ...others.map((id) => ({
        conversation_id: conv.id,
        user_id: id,
        role: "member" as const,
      })),
    ];
    const { error: mErr } = await supabaseAdmin.from("chat_conversation_members").insert(rows);
    if (mErr) throw new Error(mErr.message);

    return { id: conv.id };
  });

/** Set my presence status (heartbeat). */
export const setPresence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status: "online" | "away" | "busy" | "offline"; customStatus?: string | null }) =>
    z
      .object({
        status: z.enum(["online", "away", "busy", "offline"]),
        customStatus: z.string().max(140).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await supabaseAdmin
      .from("user_presence")
      .upsert(
        {
          user_id: userId,
          status: data.status,
          custom_status: data.customStatus ?? null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    return { ok: true };
  });

/** List teammates with their current presence + manual status for the chat sidebar. */
export const listTeammatesWithStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data: profs, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, avatar_url, manual_status, manual_status_until")
      .neq("id", userId)
      .order("full_name", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    const allProfs = profs ?? [];
    const profMap = await getChatProfileMap([userId, ...allProfs.map((p) => p.id)]);
    const me = getChatProfile(profMap, userId);
    const visibleProfs = allProfs.filter((p) => canChatBetween(me, getChatProfile(profMap, p.id)));
    const ids = visibleProfs.map((p) => p.id);
    const safeIds = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];
    const { data: presence } = await supabaseAdmin
      .from("user_presence")
      .select("user_id, status, custom_status, last_seen_at")
      .in("user_id", safeIds);
    const presMap = new Map(presence?.map((p) => [p.user_id, p]) ?? []);
    const now = Date.now();
    const teammates = visibleProfs.map((p) => {
      const pres = presMap.get(p.id);
      const until = p.manual_status_until ? new Date(p.manual_status_until).getTime() : 0;
      const manual = until && until <= now ? null : (p.manual_status ?? null);
      return {
        id: p.id,
        name: p.full_name ?? p.email ?? "Teammate",
        email: p.email ?? null,
        avatar_url: p.avatar_url ?? null,
        presence: (pres?.status as string | undefined) ?? "offline",
        custom_status: pres?.custom_status ?? null,
        manual_status: manual,
        last_seen_at: pres?.last_seen_at ?? null,
      };
    });
    return { teammates };
  });

/** Request a signed upload URL for an attachment. Returns the path under <conversationId>/<uuid>-<name>. */
export const createAttachmentUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId: string; fileName: string }) =>
    z
      .object({
        conversationId: z.string().uuid(),
        fileName: z.string().min(1).max(200),
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
    const safeName = data.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
    const path = `${data.conversationId}/${crypto.randomUUID()}-${safeName}`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from("chat-attachments")
      .createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return { path, token: signed.token, signedUrl: signed.signedUrl };
  });

/** Fetch a fresh signed read URL for an attachment path. */
export const getAttachmentUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { path: string }) => z.object({ path: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const convId = data.path.split("/")[0];
    const { data: isMem } = await supabaseAdmin.rpc("chat_is_member", {
      _conv: convId,
      _user: userId,
    });
    if (!isMem) throw new Error("Not a member of this conversation");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("chat-attachments")
      .createSignedUrl(data.path, 60 * 60);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

/** Resolve a Lead Vault URL (e.g. /leads/<uuid>) into a small preview card. */
export const getLeadPreview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { leadId: string }) => z.object({ leadId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("id, first_name, last_name, phone, dispo, home_dispo, current_carrier")
      .eq("id", data.leadId)
      .maybeSingle();
    if (!lead) return { lead: null };
    return {
      lead: {
        id: lead.id,
        name: [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unnamed lead",
        phone: lead.phone,
        dispo: lead.dispo ?? lead.home_dispo ?? null,
        carrier: lead.current_carrier,
      },
    };
  });