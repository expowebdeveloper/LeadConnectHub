// Shared definitions for which dispositions count as agent engagement /
// "quote-tier" work across analytics, hub stats, and activity scoring.
//
// QUOTED_DISPOS: the prospect was engaged enough that a quote was given OR
// a real follow-up / x-date commitment was captured. Used as the denominator
// for close-rate, and as the trigger for counting a "quote" action when a
// dispo_changed activity lands on one of these values.
export const QUOTED_DISPOS = new Set<string>([
  "quoted",
  "sold",
  "follow_up",
  "x_date",
]);

export function isQuotedDispo(d: string | null | undefined): boolean {
  return !!d && QUOTED_DISPOS.has(d);
}