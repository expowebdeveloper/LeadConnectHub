import { tool } from "ai";
import { z } from "zod";
import {
  kpiSnapshot, agentPerformance, vendorPerformance, untouchedLeads,
  leadPriorityList, sourceRoi, projection, neglectedLeads, trendCompare, getSettings,
  activityByHour, activityByDayOfWeek, historicalComparison,
} from "./ai-analytics.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const rangeSchema = z.enum([
  "today", "yesterday", "week", "month", "last_month", "ytd",
  "last_7d", "last_30d", "last_60d", "last_90d", "all_time",
]);

export type AuditEntry = {
  tool_name: string;
  tool_input: unknown;
  tool_output_summary: string;
  data_sources: string[];
};

export function buildAiTools(audit: (e: AuditEntry) => void) {
  function logged<T extends Record<string, unknown>>(
    name: string,
    sources: string[],
    fn: (input: T) => Promise<unknown>,
  ) {
    return async (input: T) => {
      const out = await fn(input);
      const summary = JSON.stringify(out).slice(0, 1000);
      audit({ tool_name: name, tool_input: input, tool_output_summary: summary, data_sources: sources });
      return out;
    };
  }

  return {
    getKpiSnapshot: tool({
      description: "Top-line CRM KPIs (new leads, claimed, calls, sales, premium, close rate) for a date range.",
      inputSchema: z.object({ range: rangeSchema.default("today") }),
      execute: logged("getKpiSnapshot", ["leads", "call_logs", "sale_events"], async ({ range }) => kpiSnapshot(range)),
    }),
    getAgentPerformance: tool({
      description: "Per-agent performance: calls, claims, quotes, sales, premium, quote/close rate. Omit agent_id for a leaderboard.",
      inputSchema: z.object({ agent_id: z.string().uuid().optional(), range: rangeSchema.default("week") }),
      execute: logged("getAgentPerformance", ["call_logs", "leads", "sale_events"], async (i) => agentPerformance(i)),
    }),
    getVendorPerformance: tool({
      description: "Per-vendor lead quality and ROI: volume, claimed, quoted, sold, premium, spend, CPL, CPS, close rate.",
      inputSchema: z.object({ vendor_id: z.string().uuid().optional(), range: rangeSchema.default("month") }),
      execute: logged("getVendorPerformance", ["leads"], async (i) => vendorPerformance(i)),
    }),
    getUntouchedLeads: tool({
      description: "Leads created more than N minutes ago that have not been claimed/contacted.",
      inputSchema: z.object({ older_than_minutes: z.number().int().min(1).max(10080).default(30), limit: z.number().int().min(1).max(200).default(50) }),
      execute: logged("getUntouchedLeads", ["leads"], async (i) => untouchedLeads(i)),
    }),
    getNeglectedLeads: tool({
      description: "Claimed leads with no activity in the last N hours (excludes sold/dnq/dnc).",
      inputSchema: z.object({ hours_since_activity: z.number().int().min(1).max(720).default(48), limit: z.number().int().min(1).max(200).default(25) }),
      execute: logged("getNeglectedLeads", ["leads"], async (i) => neglectedLeads(i)),
    }),
    getLeadPriorityList: tool({
      description: "Prioritized list of leads to work next, sorted by composite score.",
      inputSchema: z.object({ agent_id: z.string().uuid().optional(), limit: z.number().int().min(1).max(100).default(25) }),
      execute: logged("getLeadPriorityList", ["leads"], async (i) => leadPriorityList(i)),
    }),
    getSourceROI: tool({
      description: "Per-source lead volume, sold, spend, cost-per-sale, close rate.",
      inputSchema: z.object({ range: rangeSchema.default("month") }),
      execute: logged("getSourceROI", ["leads"], async ({ range }) => sourceRoi(range)),
    }),
    getProjection: tool({
      description: "Month-end projection using business-day pace. kind=sales|premium.",
      inputSchema: z.object({ kind: z.enum(["sales", "premium"]).default("sales"), goal: z.number().optional() }),
      execute: logged("getProjection", ["sale_events", "ai_settings"], async (i) => projection(i)),
    }),
    getTrendComparison: tool({
      description: "Compare a single metric across two date ranges.",
      inputSchema: z.object({
        metric: z.enum(["leads", "sales", "premium", "calls"]),
        range_a: rangeSchema,
        range_b: rangeSchema,
      }),
      execute: logged("getTrendComparison", ["leads", "sale_events", "call_logs"], async (i) => trendCompare(i)),
    }),
    getAlerts: tool({
      description: "Open AI alerts (warnings/critical) the system has flagged.",
      inputSchema: z.object({}),
      execute: logged("getAlerts", ["ai_alerts"], async () => {
        const { data } = await supabaseAdmin.from("ai_alerts").select("*").is("resolved_at", null).order("created_at", { ascending: false }).limit(20);
        return { alerts: data ?? [] };
      }),
    }),
    getSettings: tool({
      description: "Current LeadVault AI settings (monthly goal, close-rate target).",
      inputSchema: z.object({}),
      execute: logged("getSettings", ["ai_settings"], async () => getSettings()),
    }),
    getActivityByHourOfDay: tool({
      description:
        "Weighted activity score by hour of day (0-23) in the business timezone. " +
        "Combines calls placed/answered, lead claims/contacts, quotes, sales, notes, tasks, " +
        "transfers, status changes, and chat messages. Automatically expands the time window " +
        "(today → week → last_7d → last_30d → last_60d → last_90d → ytd → all_time) until " +
        "min_samples is reached. Use for 'what time of day is the team most active', peak " +
        "hour, best blitz window, etc.",
      inputSchema: z.object({
        range: rangeSchema.optional(),
        min_samples: z.number().int().min(1).max(10000).optional(),
      }),
      execute: logged(
        "getActivityByHourOfDay",
        ["call_logs", "leads", "lead_activities", "sale_events", "chat_messages"],
        async (i) => activityByHour(i),
      ),
    }),
    getActivityByDayOfWeek: tool({
      description:
        "Weighted activity score by day of week (Sun-Sat) in the business timezone, with " +
        "automatic historical fallback. Use for 'what day of the week is best/worst', weekly " +
        "patterns, scheduling decisions.",
      inputSchema: z.object({
        range: rangeSchema.optional(),
        min_samples: z.number().int().min(1).max(10000).optional(),
      }),
      execute: logged(
        "getActivityByDayOfWeek",
        ["call_logs", "leads", "lead_activities", "sale_events", "chat_messages"],
        async (i) => activityByDayOfWeek(i),
      ),
    }),
    getHistoricalComparison: tool({
      description:
        "Compare a metric in a current window against the historical average over a longer " +
        "window (e.g. today vs last_90d average). Returns delta, % change vs avg, and a " +
        "verdict (unusually_high/low/near_average). metric=activity_events combines calls, " +
        "claims, activities, sales, and messages.",
      inputSchema: z.object({
        metric: z.enum(["leads", "sales", "premium", "calls", "activity_events"]),
        current_range: rangeSchema.optional(),
        historical_range: rangeSchema.optional(),
      }),
      execute: logged(
        "getHistoricalComparison",
        ["leads", "call_logs", "sale_events", "lead_activities", "chat_messages"],
        async (i) => historicalComparison(i),
      ),
    }),
    getLeadDetail: tool({
      description: "Full detail for a single lead by id.",
      inputSchema: z.object({ lead_id: z.string().uuid() }),
      execute: logged("getLeadDetail", ["leads"], async ({ lead_id }) => {
        const { data } = await supabaseAdmin.from("leads").select("*").eq("id", lead_id).maybeSingle();
        return data ?? { error: "not_found" };
      }),
    }),
  };
}

// Action tools — require admin confirmation in the UI before executing.
export function buildAiActionTools(audit: (e: AuditEntry) => void, userId: string) {
  return {
    addLeadNote: tool({
      description: "Add a note (activity) to a lead. Requires confirmation before execution.",
      inputSchema: z.object({ lead_id: z.string().uuid(), body: z.string().min(1).max(2000) }),
      execute: async ({ lead_id, body }) => {
        const { error } = await supabaseAdmin.from("lead_activities").insert({
          lead_id, lead_table: "leads", user_id: userId, action: "ai_note", details: { body },
        } as never);
        audit({ tool_name: "addLeadNote", tool_input: { lead_id, body }, tool_output_summary: error ? `error: ${error.message}` : "ok", data_sources: ["lead_activities"] });
        if (error) return { ok: false, error: error.message };
        return { ok: true };
      },
    }),
    reassignLead: tool({
      description: "Reassign a lead to a different agent. Requires confirmation.",
      inputSchema: z.object({ lead_id: z.string().uuid(), to_agent_id: z.string().uuid() }),
      execute: async ({ lead_id, to_agent_id }) => {
        const { error } = await supabaseAdmin
          .from("leads")
          .update({ agent_id: to_agent_id, claimed_by: to_agent_id, claimed_at: new Date().toISOString() })
          .eq("id", lead_id);
        audit({ tool_name: "reassignLead", tool_input: { lead_id, to_agent_id }, tool_output_summary: error ? `error: ${error.message}` : "ok", data_sources: ["leads"] });
        if (error) return { ok: false, error: error.message };
        return { ok: true };
      },
    }),
    pinInsight: tool({
      description: "Pin an insight/summary to the AI dashboard so it persists for admins.",
      inputSchema: z.object({ title: z.string().min(1).max(200), body: z.string().min(1).max(4000) }),
      execute: async ({ title, body }) => {
        const { error } = await supabaseAdmin.from("ai_pinned_insights").insert({ user_id: userId, title, body: { text: body } } as never);
        audit({ tool_name: "pinInsight", tool_input: { title }, tool_output_summary: error ? `error: ${error.message}` : "pinned", data_sources: ["ai_pinned_insights"] });
        if (error) return { ok: false, error: error.message };
        return { ok: true };
      },
    }),
  };
}