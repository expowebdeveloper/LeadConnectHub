import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Dispo } from "@/lib/constants";

type Table = "leads" | "list_leads";

type Row = {
  claimed_by: string | null;
  home_claimed_by: string | null;
  agent_id: string | null;
  dispo: string | null;
  home_dispo: string | null;
  quoted_premium: number | null;
  home_quoted_premium: number | null;
  agent_notes: string | null;
  home_agent_notes: string | null;
  existing_client_lines: string[] | null;
};

const SELECT =
  "claimed_by,home_claimed_by,agent_id,dispo,home_dispo,quoted_premium,home_quoted_premium,agent_notes,home_agent_notes,existing_client_lines";

/**
 * Dispositions that REQUIRE a quoted premium > 0 before the lead can be
 * closed out. Anything not in this set (voicemail, dead, dnc, wrong number,
 * already-has-allstate, already-a-client, not-quoted, etc.) can be closed
 * without a premium.
 */
const QUOTE_DISPOS = new Set<Dispo>([
  "quoted",
  "follow_up",
  "x_date",
  "sold",
]);

export function dispoRequiresPremium(d: Dispo | null | undefined): boolean {
  if (!d) return false;
  return QUOTE_DISPOS.has(d);
}

function sideMissing(
  side: "auto" | "home",
  row: Row,
  hasThreadNote: boolean,
): string[] {
  const get =
    side === "auto"
      ? { dispo: row.dispo, premium: row.quoted_premium, notes: row.agent_notes }
      : { dispo: row.home_dispo, premium: row.home_quoted_premium, notes: row.home_agent_notes };
  const missing: string[] = [];
  if (!get.dispo) missing.push("dispo");
  // Notes are ALWAYS required to close out a lead — agents must explain
  // what happened, even on terminal/no-sale dispos. Either the legacy
  // `agent_notes` column OR a threaded note (lead_notes for this side)
  // satisfies the requirement.
  const hasLegacyNote = !!(get.notes && get.notes.trim());
  if (!hasLegacyNote && !hasThreadNote) missing.push("notes");
  // Quoted premium required for any dispo that implies a quote was given.
  // Treat 0 / negative as missing — a $0 premium is the legacy save-bug
  // value, never a legitimate quote.
  const premiumMissing = get.premium == null || Number(get.premium) <= 0;
  if (dispoRequiresPremium(get.dispo as Dispo | null) && premiumMissing) {
    missing.push("quoted premium");
  }
  // "Already a Client" requires capturing which lines they currently hold
  // so the rest of the team knows what cross-sell opportunities remain.
  if (
    get.dispo === "already_a_client" &&
    (!row.existing_client_lines || row.existing_client_lines.length === 0)
  ) {
    missing.push("existing client lines");
  }
  return missing;
}

/**
 * Returns true when the dialog is allowed to close.
 * Blocks (toasts) when the agent worked a side that lacks dispo / notes / quoted premium.
 * Admins always pass. Read-only viewers (no claim, no agent_id match) always pass.
 */
export async function canCloseLead(
  table: Table,
  leadId: string,
  userId: string,
  isAdmin: boolean,
): Promise<boolean> {
  if (isAdmin || !userId) return true;
  // Forced dispo / notes / premium enforcement is only meaningful for live
  // (transferred-in) leads. Shark-tank and other list_leads workflows are
  // hunting/prospecting — agents must be free to make a call, jot a note,
  // and walk away without being trapped into a full disposition.
  if (table !== "leads") return true;
  const { data, error } = await supabase
    .from(table)
    .select(SELECT)
    .eq("id", leadId)
    .maybeSingle();
  if (error || !data) return true; // don't trap on transient errors
  const row = data as unknown as Row;

  // Pull threaded notes for this lead so the new LeadNotesThread counts
  // toward the "notes" requirement (the legacy agent_notes textarea was
  // removed from the dispo card).
  const { data: threadNotes } = await supabase
    .from("lead_notes")
    .select("line_key")
    .eq("lead_table", table)
    .eq("lead_id", leadId)
    .in("line_key", ["auto", "home"])
    .limit(50);
  const threadRows = (threadNotes ?? []) as Array<{ line_key: string | null }>;
  const hasAutoThreadNote = threadRows.some((n) => n.line_key === "auto");
  const hasHomeThreadNote = threadRows.some((n) => n.line_key === "home");

  // Also consider the agent as having "worked" the lead when they have any
  // recent call activity on it — covers the case where a busy / no-answer
  // outcome released the claim, but the agent had still set a dispo on the
  // call and is now trying to walk away without notes.
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  const sinceIso = new Date(Date.now() - SIX_HOURS_MS).toISOString();
  const { data: recentActs } = await supabase
    .from("lead_activities" as never)
    .select("action,details,created_at")
    .eq("lead_table", table)
    .eq("lead_id", leadId)
    .eq("user_id", userId)
    .gte("created_at", sinceIso)
    .limit(50);
  const acts = (recentActs ?? []) as Array<{ action: string }>;
  const hasRecentCall = acts.some(
    (a) =>
      a.action === "call_logged" ||
      a.action === "call_guide_result" ||
      a.action === "call_guide_step" ||
      a.action === "call_guide_voicemail",
  );
  // "Real work" signal — the user actually engaged with the lead, not just
  // dialed and hung up. Pure dial-and-hangup (call_logged / lead_opened)
  // is excluded on purpose so shark-tank hunting calls don't force a
  // dispo when nothing came of them.
  const hasRecentTouch = acts.some(
    (a) =>
      a.action === "lead_claimed" ||
      a.action === "agent_notes_edited" ||
      a.action === "dispo_changed" ||
      a.action === "email_sent" ||
      a.action === "note_added" ||
      a.action === "note_edited" ||
      a.action === "call_guide_result" ||
      a.action === "call_guide_step" ||
      a.action === "call_guide_voicemail",
  );

  const workedAuto =
    row.claimed_by === userId ||
    (!row.claimed_by && row.agent_id === userId) ||
    // A dispo was set without notes — somebody worked this side, force the
    // current closer to finish it out before walking away.
    (!!row.dispo && (!row.agent_notes || !row.agent_notes.trim()) && hasRecentCall) ||
    // Auto-claim race: the user clearly worked the lead recently even if
    // the claim hasn't materialized on the row yet.
    (hasRecentTouch && !row.claimed_by);
  const workedHome =
    row.home_claimed_by === userId ||
    (!!row.home_dispo && (!row.home_agent_notes || !row.home_agent_notes.trim()) && hasRecentCall);

  const blocks: string[] = [];
  // On live leads, Auto enforcement is unconditional — agents must finish
  // the Auto side (dispo + notes, plus premium when the dispo implies a
  // quote) before walking away, even if the claim was released or the
  // activity log didn't catch their work. For list_leads / shark-tank,
  // keep the legacy "only if they worked it" gate.
  const enforceAuto = table === "leads" ? true : workedAuto;
  if (enforceAuto) {
    const m = sideMissing("auto", row, hasAutoThreadNote);
    if (m.length) blocks.push(`Auto: add ${m.join(", ")}`);
  }
  if (workedHome) {
    const m = sideMissing("home", row, hasHomeThreadNote);
    if (m.length) blocks.push(`Home: add ${m.join(", ")}`);
  }
  if (blocks.length === 0) return true;

  toast.error("Finish disposing this lead before closing", {
    description: blocks.join(" · "),
  });
  return false;
}