/**
 * Shared rules for counting "quotes" from lead activity rows.
 *
 * A quote is credited only the FIRST time a premium is set on a given
 * side / extra-line for a given lead (empty/0 -> positive number).
 * Later edits to that same premium do NOT count again.
 *
 * Auto / home / extra lines all follow this rule.
 */

export type QuoteActivityRow = {
  action: string;
  lead_id: string | null;
  lead_table?: string | null;
  details: Record<string, unknown> | null;
};

export function isQuoteAction(action: string): boolean {
  return action === "quoted_premium_changed" || action === "line_premium_changed";
}

/** True when this activity row represents a first-time premium set. */
export function isInitialQuoteActivity(a: QuoteActivityRow): boolean {
  if (!isQuoteAction(a.action)) return false;
  const d = (a.details ?? {}) as Record<string, unknown>;
  const from = d.from;
  const to = d.to;
  const fromEmpty =
    from == null || from === "" || Number(from) === 0;
  const toNum = Number(to);
  return fromEmpty && Number.isFinite(toNum) && toNum > 0;
}

/**
 * Stable dedupe key for a quote activity row. Returns null if the row
 * is not a first-time quote.
 *
 * Includes lead_table so a live lead and a list lead with the same UUID
 * cannot collide. Auto/home key on `side`; extra lines key on `line_id`.
 */
export function quoteCreditKey(a: QuoteActivityRow): string | null {
  if (!a.lead_id || !isInitialQuoteActivity(a)) return null;
  const d = (a.details ?? {}) as Record<string, unknown>;
  const table = a.lead_table ?? "";
  if (a.action === "line_premium_changed") {
    const lineId = String(d.line_id ?? "unknown");
    return `${table}:${a.lead_id}:line:${lineId}`;
  }
  const side =
    String(d.side ?? "").toLowerCase().trim() || "unknown";
  return `${table}:${a.lead_id}:${side}`;
}