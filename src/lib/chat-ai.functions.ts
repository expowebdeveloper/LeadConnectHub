import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MODEL = "google/gemini-3-flash-preview";

async function fetchConversationContext(
  conversationId: string,
  opts: { since?: string | null; limit?: number } = {},
) {
  const limit = opts.limit ?? 100;
  let query = supabaseAdmin
    .from("chat_messages")
    .select("body, sender_id, created_at, message_type")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (opts.since) query = query.gte("created_at", opts.since);
  const { data: msgs } = await query;
  const ordered = (msgs ?? []).reverse();
  const sids = Array.from(new Set(ordered.map((m) => m.sender_id).filter((s): s is string => !!s)));
  const { data: profs } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, email")
    .in("id", sids.length ? sids : ["00000000-0000-0000-0000-000000000000"]);
  const pmap = new Map((profs ?? []).map((p) => [p.id, p.full_name ?? p.email ?? "Someone"]));
  return ordered
    .map((m) => {
      const who = m.sender_id ? pmap.get(m.sender_id) ?? "Someone" : "System";
      return `${who}: ${(m.body ?? "").slice(0, 1000)}`;
    })
    .join("\n");
}

async function callGateway(prompt: string, system?: string): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: prompt },
      ],
    }),
  });
  if (res.status === 429) throw new Error("AI is rate limited. Try again shortly.");
  if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace settings.");
  if (!res.ok) throw new Error(`AI request failed (${res.status})`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "";
}

export const summarizeConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId: string; since?: string | null }) =>
    z.object({ conversationId: z.string().uuid(), since: z.string().datetime().nullable().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await fetchConversationContext(data.conversationId, { since: data.since ?? null });
    if (!ctx.trim()) return { text: "No messages to summarize yet." };
    const text = await callGateway(
      `Summarize this team chat for a sales team. Be concise (4-6 bullets). Highlight decisions, blockers, and any commitments.\n\n${ctx}`,
      "You are a concise sales operations assistant.",
    );
    return { text };
  });

export const summarizeMissedMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId: string; lastSeenAt: string }) =>
    z.object({ conversationId: z.string().uuid(), lastSeenAt: z.string().datetime() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await fetchConversationContext(data.conversationId, { since: data.lastSeenAt });
    if (!ctx.trim()) return { text: "You're all caught up." };
    const text = await callGateway(
      `Catch me up on what I missed in this chat. Use 3-5 short bullets focused on what matters for a sales agent.\n\n${ctx}`,
    );
    return { text };
  });

export const extractActionItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId: string }) =>
    z.object({ conversationId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await fetchConversationContext(data.conversationId);
    if (!ctx.trim()) return { items: [] };
    const text = await callGateway(
      `Extract concrete action items from this chat. Return ONE per line, prefix with "- ". No headings, no extra text.\n\n${ctx}`,
    );
    const items = text
      .split("\n")
      .map((l) => l.replace(/^[-*•]\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 12);
    return { items };
  });

export const suggestFollowUpTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId: string }) =>
    z.object({ conversationId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await fetchConversationContext(data.conversationId, { limit: 50 });
    if (!ctx.trim()) return { title: "", description: "" };
    const text = await callGateway(
      `Based on this chat, suggest a single follow-up task. Reply in this exact format and nothing else:\nTITLE: <short title>\nDESC: <one short sentence>\n\n${ctx}`,
    );
    const tMatch = text.match(/TITLE:\s*(.+)/i);
    const dMatch = text.match(/DESC:\s*([\s\S]+)/i);
    return {
      title: (tMatch?.[1] ?? "Follow up").trim().slice(0, 200),
      description: (dMatch?.[1] ?? "").trim().slice(0, 1000),
    };
  });

export const draftReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId: string; hint?: string }) =>
    z.object({ conversationId: z.string().uuid(), hint: z.string().max(500).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await fetchConversationContext(data.conversationId, { limit: 30 });
    const text = await callGateway(
      `Draft a short, friendly, professional reply for the next message in this sales team chat.${data.hint ? ` Tone/intent: ${data.hint}.` : ""} Reply with the message only — no quotes, no preamble.\n\n${ctx}`,
    );
    return { text: text.trim() };
  });

export const suggestRelatedLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId: string }) =>
    z.object({ conversationId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await fetchConversationContext(data.conversationId, { limit: 30 });
    // Heuristic: pull phones/emails/names mentioned, find leads
    const phones = Array.from(new Set(ctx.match(/\+?\d[\d\s().-]{7,}\d/g) ?? [])).slice(0, 5);
    const emails = Array.from(new Set(ctx.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [])).slice(0, 5);
    if (!phones.length && !emails.length) return { leads: [] };
    const filters: string[] = [];
    for (const p of phones) filters.push(`phone.ilike.%${p.replace(/\D/g, "").slice(-7)}%`);
    for (const e of emails) filters.push(`email.ilike.%${e}%`);
    const { data: leads } = await supabaseAdmin
      .from("leads")
      .select("id, first_name, last_name, phone, email, dispo")
      .or(filters.join(","))
      .limit(5);
    return {
      leads: (leads ?? []).map((l) => ({
        id: l.id,
        name: [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email || l.phone || "Lead",
        phone: l.phone,
        email: l.email,
        dispo: l.dispo,
      })),
    };
  });