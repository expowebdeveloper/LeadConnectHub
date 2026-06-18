import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages, streamText, stepCountIs, type UIMessage,
} from "ai";
import { createClient } from "@supabase/supabase-js";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { buildAiTools, buildAiActionTools, type AuditEntry } from "@/lib/ai-tools.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SYSTEM_PROMPT = `You are LeadVault AI — an internal sales operations analyst, strategist, and assistant for LeadVault.

Hard rules:
- Never invent numbers. ALWAYS call a tool to get data before answering anything quantitative.
- Always state the date range you used and any assumptions.
- For projections, state confidence (low/medium/high) and that they are estimates.
- If data is missing or not tracked, say so explicitly. Do not guess.
- When you call an action tool (addLeadNote, reassignLead, pinInsight) you MUST first describe what you're about to change and ask the user to confirm.
- Be concise. Use compact tables and bullets. Lead with the direct answer, then supporting numbers, then a recommendation if useful.
- End answers with 2-4 short suggested follow-up questions on their own lines prefixed with "→".

You have read access to leads, vendors, agents, calls, sales, projections, source ROI, alerts, and settings.

Smart historical fallback (MANDATORY for analytical questions):
- For any question about trends, peak activity, best time of day, best day of week, agent/vendor patterns, close rates, or production pace — DO NOT stop at today or this week if the sample is too small.
- Prefer the tools that already do automatic fallback: getActivityByHourOfDay, getActivityByDayOfWeek, getHistoricalComparison. They walk today → week → last_7d → last_30d → last_60d → last_90d → ytd → all_time until min_samples is reached.
- For "what time of day is the team most active" type questions, use getActivityByHourOfDay (weighted: calls, claims, contacts, quotes, sales, notes, tasks, transfers, status changes, messages). Report:
  * peak hour and top 3 hours (in business timezone)
  * most active time block
  * a compact table: Hour | Score | Calls | Claims | Quotes | Sales (only the rows that have any activity)
  * range_used, sample_size, confidence, and whether fallback was used
  * a short reasoning trail ("checked today → too few → expanded to last_90d → 1,284 samples")
  * 2–3 concrete recommendations from the tool's recommendations field
- For "is today/this week unusual" questions, also call getHistoricalComparison so you can say things like "today is unusually low vs the 90-day average".
- Minimum sample sizes: time-of-day 50, day-of-week 50, agent trend 20, vendor quality 25, close rate 10. Only say "not enough data" if even all_time is below the minimum.
- Always surface confidence (high/medium/low) and never present low-confidence numbers as facts.`;

async function authorize(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return { error: "Unauthorized", status: 401 as const };
  const token = auth.slice(7);
  const url = process.env.SUPABASE_URL!;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const sb = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims?.sub) return { error: "Unauthorized", status: 401 as const };
  const userId = String(data.claims.sub);
  const { data: isAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" as never } as never);
  if (!isAdmin) return { error: "Forbidden — LeadVault AI is admin-only", status: 403 as const };
  return { userId };
}

export const Route = createFileRoute("/api/ai/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorize(request);
        if ("error" in auth) return new Response(auth.error, { status: auth.status });
        const userId = auth.userId;

        const body = (await request.json()) as {
          messages?: UIMessage[];
          conversationId?: string;
          context?: { kind?: string; id?: string | null };
        };
        const messages = body.messages;
        if (!Array.isArray(messages)) return new Response("messages required", { status: 400 });

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        // Ensure conversation
        let conversationId = body.conversationId;
        if (!conversationId) {
          const firstUser = messages.find((m) => m.role === "user");
          const titleText = (firstUser?.parts ?? [])
            .map((p: any) => (p?.type === "text" ? p.text : ""))
            .join(" ").trim().slice(0, 80) || "New conversation";
          const { data: conv } = await supabaseAdmin
            .from("ai_conversations")
            .insert({ owner_id: userId, title: titleText, context_kind: (body.context?.kind as never) ?? "global", context_id: body.context?.id ?? null } as never)
            .select("id")
            .single();
          conversationId = (conv as any)?.id;
        }

        const auditQueue: AuditEntry[] = [];
        const auditFn = (e: AuditEntry) => auditQueue.push(e);
        const lastUserText = (messages.filter((m) => m.role === "user").at(-1)?.parts ?? [])
          .map((p: any) => (p?.type === "text" ? p.text : "")).join(" ").trim().slice(0, 1000);

        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3-flash-preview");

        const tools = {
          ...buildAiTools(auditFn),
          ...buildAiActionTools(auditFn, userId),
        };

        const contextHint = body.context?.kind && body.context?.id
          ? `\nCurrent CRM context: ${body.context.kind} = ${body.context.id}. Use getLeadDetail when relevant.`
          : "";

        const result = streamText({
          model,
          system: SYSTEM_PROMPT + contextHint,
          messages: await convertToModelMessages(messages),
          tools,
          stopWhen: stepCountIs(50),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          headers: { "X-AI-Conversation-Id": conversationId ?? "" },
          onFinish: async ({ messages: finalMessages }) => {
            try {
              if (!conversationId) return;
              const last = finalMessages[finalMessages.length - 1];
              if (last) {
                await supabaseAdmin.from("ai_messages").insert([
                  // Insert only the latest user msg + assistant msg (rest already saved on previous turns).
                  // Simplified: insert the last user + last assistant.
                  ...(messages.length ? [{
                    conversation_id: conversationId,
                    role: messages[messages.length - 1].role,
                    message_id: (messages[messages.length - 1] as any).id ?? null,
                    parts: messages[messages.length - 1].parts as never,
                  }] : []),
                  {
                    conversation_id: conversationId,
                    role: last.role,
                    message_id: (last as any).id ?? null,
                    parts: last.parts as never,
                  },
                ] as never);
                await supabaseAdmin.from("ai_conversations").update({ updated_at: new Date().toISOString() } as never).eq("id", conversationId);
              }
              if (auditQueue.length) {
                await supabaseAdmin.from("ai_audit_log").insert(
                  auditQueue.map((a) => ({
                    user_id: userId,
                    conversation_id: conversationId ?? null,
                    question: lastUserText,
                    tool_name: a.tool_name,
                    tool_input: a.tool_input as never,
                    tool_output_summary: a.tool_output_summary,
                    data_sources: a.data_sources,
                  })) as never,
                );
              }
            } catch (err) {
              console.error("[ai.chat] persistence error", err);
            }
          },
        });
      },
    },
  },
});