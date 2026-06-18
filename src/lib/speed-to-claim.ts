/**
 * Speed-to-claim metric + reward helpers.
 *
 * Only applies to live `leads` table claims. Measured from the lead's
 * `created_at` to when the agent claimed it. Anything beyond
 * `SPEED_MAX_SECONDS` (1 hour) is ignored — those are re-claims or stale
 * grabs from shark tank, not "speed-to-claim" events.
 */

export type SpeedTier = "lightning" | "fast" | "quick" | null;

export const SPEED_TIER_LABEL: Record<Exclude<SpeedTier, null>, string> = {
  lightning: "Lightning",
  fast: "Fast",
  quick: "Quick",
};

export const SPEED_TIER_EMOJI: Record<Exclude<SpeedTier, null>, string> = {
  lightning: "⚡",
  fast: "🔥",
  quick: "⏱",
};

/** Max seconds we count toward the speed-to-claim metric. */
export const SPEED_MAX_SECONDS = 60 * 60;

export function speedToClaimSeconds(
  createdAt: string | Date | null | undefined,
  claimedAt: string | Date | null | undefined,
): number | null {
  if (!createdAt || !claimedAt) return null;
  const c = new Date(createdAt).getTime();
  const k = new Date(claimedAt).getTime();
  if (!Number.isFinite(c) || !Number.isFinite(k)) return null;
  const s = Math.floor((k - c) / 1000);
  if (s < 0) return null;
  if (s > SPEED_MAX_SECONDS) return null;
  return s;
}

export function speedTier(seconds: number | null | undefined): SpeedTier {
  if (seconds == null) return null;
  if (seconds <= 30) return "lightning";
  if (seconds <= 120) return "fast";
  if (seconds <= 600) return "quick";
  return null;
}

/** Bonus activity points stacked on top of the existing claim score. */
export function speedBonus(seconds: number | null | undefined): number {
  const t = speedTier(seconds);
  if (t === "lightning") return 5;
  if (t === "fast") return 3;
  if (t === "quick") return 1;
  return 0;
}

export function formatSpeed(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export type SpeedToClaimSummary = {
  samples: number;
  avgSec: number | null;
  bestSec: number | null;
  bonus: number;
  tiers: { lightning: number; fast: number; quick: number };
};

export function emptySpeedSummary(): SpeedToClaimSummary {
  return {
    samples: 0,
    avgSec: null,
    bestSec: null,
    bonus: 0,
    tiers: { lightning: 0, fast: 0, quick: 0 },
  };
}

export function addSpeedSample(s: SpeedToClaimSummary, seconds: number): void {
  const prevAvg = s.avgSec ?? 0;
  s.samples += 1;
  s.avgSec = Math.round((prevAvg * (s.samples - 1) + seconds) / s.samples);
  s.bestSec = s.bestSec == null ? seconds : Math.min(s.bestSec, seconds);
  const t = speedTier(seconds);
  if (t) s.tiers[t] += 1;
  s.bonus += speedBonus(seconds);
}