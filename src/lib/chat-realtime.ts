import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Subscribe to message inserts/updates/deletes for a specific conversation
 * AND broadcast typing events through the same channel.
 */
export function subscribeConversation(opts: {
  conversationId: string;
  onMessageChange: () => void;
  onReactionChange?: () => void;
  onTyping?: (userId: string, userName: string) => void;
}): () => void {
  const ch = supabase
    .channel(`chat:conv:${opts.conversationId}:${crypto.randomUUID()}`, {
      config: { broadcast: { self: false } },
    })
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "chat_messages",
        filter: `conversation_id=eq.${opts.conversationId}`,
      },
      () => opts.onMessageChange(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "chat_message_reactions" },
      () => opts.onReactionChange?.(),
    )
    .on("broadcast", { event: "typing" }, (payload) => {
      const p = payload.payload as { userId?: string; name?: string };
      if (p?.userId) opts.onTyping?.(p.userId, p.name ?? "Someone");
    })
    .subscribe();

  return () => {
    void supabase.removeChannel(ch);
  };
}

/** Broadcast a typing event into the conversation's realtime channel. */
export function broadcastTyping(conversationId: string, userId: string, name: string) {
  const ch = supabase.channel(`chat:conv:${conversationId}`);
  void ch.send({ type: "broadcast", event: "typing", payload: { userId, name } });
}

/** Subscribe to any new message in any conversation the user belongs to (for global unread). */
export function subscribeAllConversations(onChange: () => void): () => void {
  const ch = supabase
    .channel(`chat:global:${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, () =>
      onChange(),
    )
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_conversation_members" }, () =>
      onChange(),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

/** Subscribe to user_presence changes (global). */
export function subscribePresence(onChange: () => void): () => void {
  const ch: RealtimeChannel = supabase
    .channel(`chat:presence:${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "user_presence" }, () =>
      onChange(),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}