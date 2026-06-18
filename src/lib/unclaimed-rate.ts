/**
 * Unclaimed Lead Rate metric.
 *
 * A live lead is "unclaimed" if neither side (auto or home) is claimed within
 * `UNCLAIMED_SLA_SECONDS` (10 min) of the lead's `created_at`.
 *
 * Per-agent attribution: at the moment the lead popped, every eligible agent
 * (on-duty AND not on a call AND not in dispo wrap-up) gets +1 to their
 * `eligibleEvents` counter. If the lead then goes unclaimed in the SLA
 * window, those same eligible agents get +1 to `missedEvents`.
 *
 * Eligibility sources:
 *   - presence_events (status history; rolled forward to find each user's
 *     status at popTs)
 *   - plivo_calls (any call covering popTs marks the user as on-call,
 *     even if user_presence didn't update)
 */

export const UNCLAIMED_SLA_SECONDS = 600; // 10 min
export const WRAP_UP_SECONDS = 60;

/**
 * Presence statuses that count as "on duty and available for an incoming
 * live lead". Excludes on_call, lunch, break, dnd, offline.
 */
export const ELIGIBLE_STATUSES = new Set<string>([
  "online",
  "away",
  "busy",
  "quoting",
  "follow_up",
  "meeting",
]);

export type PresenceEvent = {
  user_id: string;
  status: string;
  started_at: string;
};

export type CallInterval = {
  user_id: string;
  started_at: string;
  /** null = still in progress. */
  ended_at: string | null;
};

/** Per-user sorted lookup tables for fast point-in-time queries. */
export type EligibilityIndex = {
  presenceByUser: Map<string, PresenceEvent[]>; // sorted asc by started_at
  callsByUser: Map<string, CallInterval[]>; // sorted asc by started_at
  /** Earliest presence_events timestamp we have. Leads before this are skipped. */
  trackingSince: number | null;
};

export function buildEligibilityIndex(
  presence: PresenceEvent[],
  calls: CallInterval[],
): EligibilityIndex {
  const presenceByUser = new Map<string, PresenceEvent[]>();
  let earliest: number | null = null;
  for (const p of presence) {
    if (!p.user_id || !p.started_at) continue;
    const ts = new Date(p.started_at).getTime();
    if (!Number.isFinite(ts)) continue;
    if (earliest == null || ts < earliest) earliest = ts;
    const arr = presenceByUser.get(p.user_id) ?? [];
    arr.push(p);
    presenceByUser.set(p.user_id, arr);
  }
  for (const arr of presenceByUser.values()) {
    arr.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  }

  const callsByUser = new Map<string, CallInterval[]>();
  for (const c of calls) {
    if (!c.user_id || !c.started_at) continue;
    const arr = callsByUser.get(c.user_id) ?? [];
    arr.push(c);
    callsByUser.set(c.user_id, arr);
  }
  for (const arr of callsByUser.values()) {
    arr.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  }

  return { presenceByUser, callsByUser, trackingSince: earliest };
}

/** Status at a point in time = latest presence_event at or before `popTs`. */
function statusAt(events: PresenceEvent[] | undefined, popTs: number): string | null {
  if (!events || events.length === 0) return null;
  let lo = 0;
  let hi = events.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = new Date(events[mid].started_at).getTime();
    if (t <= popTs) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? events[best].status : null;
}

/** True if user has a Plivo call covering `popTs`, or one that ended in the
 *  last `WRAP_UP_SECONDS` (post-call wrap-up exemption). */
function onCallOrWrapUp(calls: CallInterval[] | undefined, popTs: number): boolean {
  if (!calls) return false;
  // Linear is fine — calls per user per window are small.
  for (const c of calls) {
    const s = new Date(c.started_at).getTime();
    if (!Number.isFinite(s)) continue;
    if (s > popTs) break; // sorted asc; no later call can cover popTs
    const e = c.ended_at ? new Date(c.ended_at).getTime() : Number.POSITIVE_INFINITY;
    if (popTs <= e) return true; // currently on call
    if (popTs - e <= WRAP_UP_SECONDS * 1000) return true; // wrap-up
  }
  return false;
}

export function wasEligibleAt(
  userId: string,
  popTs: number,
  idx: EligibilityIndex,
): boolean {
  const status = statusAt(idx.presenceByUser.get(userId), popTs);
  if (!status || !ELIGIBLE_STATUSES.has(status)) return false;
  if (onCallOrWrapUp(idx.callsByUser.get(userId), popTs)) return false;
  return true;
}

export type UnclaimedSummary = {
  eligibleEvents: number;
  missedEvents: number;
  /** 0..1 */
  rate: number;
};

export function emptyUnclaimedSummary(): UnclaimedSummary {
  return { eligibleEvents: 0, missedEvents: 0, rate: 0 };
}

export function bumpUnclaimed(s: UnclaimedSummary, missed: boolean): void {
  s.eligibleEvents += 1;
  if (missed) s.missedEvents += 1;
  s.rate = s.eligibleEvents > 0 ? s.missedEvents / s.eligibleEvents : 0;
}

export function formatUnclaimedRate(rate: number | null | undefined): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 100)}%`;
}

export function unclaimedRateColor(rate: number | null | undefined): string {
  if (rate == null) return "text-muted-foreground";
  if (rate <= 0.10) return "text-emerald-400";
  if (rate <= 0.25) return "text-amber-400";
  return "text-rose-400";
}

export type LiveLeadForUnclaimed = {
  id: string;
  created_at: string;
  claimed_at: string | null;
  home_claimed_at: string | null;
};

/**
 * Returns true if the lead is "unclaimed" — i.e. neither side was claimed
 * within UNCLAIMED_SLA_SECONDS of created_at.
 */
export function leadIsUnclaimed(lead: LiveLeadForUnclaimed): boolean {
  const created = new Date(lead.created_at).getTime();
  if (!Number.isFinite(created)) return false;
  const sla = created + UNCLAIMED_SLA_SECONDS * 1000;
  const auto = lead.claimed_at ? new Date(lead.claimed_at).getTime() : null;
  const home = lead.home_claimed_at ? new Date(lead.home_claimed_at).getTime() : null;
  if (auto != null && auto <= sla) return false;
  if (home != null && home <= sla) return false;
  return true;
}
