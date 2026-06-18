/**
 * Commission engine — pure functions, no I/O.
 * Mirrors the Homie / Autobot / Service rules from the standalone
 * Commission Tracker, adapted to work directly off sold leads.
 */

export type AgentType = "homie" | "autobot" | "service";

export const SERVICE_RATE = 0.02;

/**
 * Admin-tunable commission knobs. Persisted under app_settings.commissions
 * and merged with DEFAULT_COMMISSION_CONFIG before being passed to the
 * calc* functions.
 */
export interface CommissionConfig {
  serviceRate: number;
  allstateServiceMin: number;
  allstateBonusMonoline: number;
  allstateBonusBundled: number;
  autobotNonAllstateRate: number;
  autobotBaseRate: number;
  autobotTierStep: number;
  autobotTierCap: number;
  autobotItemsPerTier: number;
  homieTiers: Array<{ min: number; rate: number; label: string }>;
  club38: { autos: number; others: number; bonus: number };
  club49: { autos: number; others: number; bonus: number };
}

export interface PolicyLike {
  carrier: string | null;
  product: string | null;
  premium: number;
  /** Per-row items count (1 for a monoline, >=2 for bundled rows). */
  items?: number;
  /** "Monoline", "Bundled", "Bundled (Preferred)". */
  reason?: string | null;
}

export const ALLSTATE_BONUS_MONOLINE = 40;
export const ALLSTATE_BONUS_BUNDLED = 80;
const ALLSTATE_BONUS_EXCLUDED_PRODUCTS = ["flood", "business owners", "bop"];

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().trim();
const AUTO = "auto";

export const isAllstate = (p: PolicyLike) => norm(p.carrier).includes("allstate");
export const isAllstateAuto = (p: PolicyLike) =>
  isAllstate(p) && norm(p.product).includes(AUTO);

export function isAllstateBonusEligible(p: PolicyLike) {
  if (!isAllstate(p)) return false;
  const prod = norm(p.product);
  return !ALLSTATE_BONUS_EXCLUDED_PRODUCTS.some((x) => prod.includes(x));
}

export function isBundledReason(reason: string | null | undefined) {
  return norm(reason).startsWith("bundled");
}

const EXCLUDED_TIER_PRODUCTS = ["flood", "business owners", "bop"];
export const isExcludedFromTierItems = (p: PolicyLike) => {
  const prod = norm(p.product);
  return EXCLUDED_TIER_PRODUCTS.some((x) => prod.includes(x));
};

const HOMIE_TIERS: Array<{ min: number; rate: number; label: string }> = [
  { min: 100_000, rate: 0.07, label: "100k+" },
  { min: 75_000, rate: 0.06, label: "75k–100k" },
  { min: 50_000, rate: 0.05, label: "50k–75k" },
  { min: 35_000, rate: 0.04, label: "35k–50k" },
  { min: 25_000, rate: 0.03, label: "25k–35k" },
  { min: 0, rate: 0, label: "0–25k" },
];

export function homieTierFor(base: number, tiers = HOMIE_TIERS) {
  const sorted = [...tiers].sort((a, b) => b.min - a.min);
  return sorted.find((t) => base >= t.min) ?? sorted[sorted.length - 1];
}

export const HOMIE_TIER_THRESHOLDS = [25_000, 35_000, 50_000, 75_000, 100_000];

export const CLUB_38 = { autos: 30, others: 8, bonus: 250 };
export const CLUB_49 = { autos: 40, others: 9, bonus: 500 };

export const ALLSTATE_SERVICE_MIN = 20;

export const DEFAULT_COMMISSION_CONFIG: CommissionConfig = {
  serviceRate: SERVICE_RATE,
  allstateServiceMin: ALLSTATE_SERVICE_MIN,
  allstateBonusMonoline: ALLSTATE_BONUS_MONOLINE,
  allstateBonusBundled: ALLSTATE_BONUS_BUNDLED,
  autobotNonAllstateRate: 0.04,
  autobotBaseRate: 0.02,
  autobotTierStep: 0.02,
  autobotTierCap: 0.18,
  autobotItemsPerTier: 12,
  homieTiers: HOMIE_TIERS,
  club38: CLUB_38,
  club49: CLUB_49,
};

export function mergeCommissionConfig(
  partial?: Partial<CommissionConfig> | null,
): CommissionConfig {
  if (!partial) return DEFAULT_COMMISSION_CONFIG;
  return {
    ...DEFAULT_COMMISSION_CONFIG,
    ...partial,
    club38: { ...DEFAULT_COMMISSION_CONFIG.club38, ...(partial.club38 ?? {}) },
    club49: { ...DEFAULT_COMMISSION_CONFIG.club49, ...(partial.club49 ?? {}) },
    homieTiers:
      partial.homieTiers && partial.homieTiers.length > 0
        ? partial.homieTiers
        : DEFAULT_COMMISSION_CONFIG.homieTiers,
  };
}

export interface NextTierProjection {
  needLabel: string;
  tierLabel: string;
  projectedCommission: number;
  delta: number;
}

export interface HomieResult {
  type: "homie";
  totalPremium: number;
  allstateAutoPremium: number;
  base: number;
  tierLabel: string;
  rate: number;
  tierCommission: number;
  allstateMonolineItems: number;
  allstateBundledItems: number;
  allstateBonus: number;
  commission: number;
  nextThreshold: number | null;
  nextTier: NextTierProjection | null;
}

export interface AutobotResult {
  type: "autobot";
  totalPremium: number;
  allstatePremium: number;
  nonAllstatePremium: number;
  tierItems: number;
  allstateRate: number;
  allstateCommission: number;
  nonAllstateCommission: number;
  allstateAutoItems: number;
  allstateOtherItems: number;
  clubBonus: number;
  clubLabel: "Club 49" | "Club 38" | null;
  commission: number;
  itemsToNextTier: number;
  nextTier: NextTierProjection | null;
}

export interface ServiceResult {
  type: "service";
  totalPremium: number;
  rate: number;
  commission: number;
  allstatePremium: number;
  allstateCommission: number;
  nonAllstatePremium: number;
  nonAllstateCommission: number;
  allstateMinApplied: number;
}

export type CommissionResult = HomieResult | AutobotResult | ServiceResult;

function sum(xs: number[]) {
  return xs.reduce((a, b) => a + Number(b || 0), 0);
}

export function calcService(
  policies: PolicyLike[],
  cfg: CommissionConfig = DEFAULT_COMMISSION_CONFIG,
): ServiceResult {
  const totalPremium = sum(policies.map((p) => p.premium));
  let allstatePremium = 0;
  let allstateCommission = 0;
  let nonAllstatePremium = 0;
  let nonAllstateCommission = 0;
  let allstateMinApplied = 0;
  for (const p of policies) {
    const premium = Number(p.premium || 0);
    if (isAllstate(p)) {
      allstatePremium += premium;
      const pct = premium * cfg.serviceRate;
      const paid = Math.max(pct, cfg.allstateServiceMin);
      if (paid > pct) allstateMinApplied += 1;
      allstateCommission += paid;
    } else {
      nonAllstatePremium += premium;
      nonAllstateCommission += premium * cfg.serviceRate;
    }
  }
  return {
    type: "service",
    totalPremium,
    rate: cfg.serviceRate,
    commission: allstateCommission + nonAllstateCommission,
    allstatePremium,
    allstateCommission,
    nonAllstatePremium,
    nonAllstateCommission,
    allstateMinApplied,
  };
}

export function calcHomie(
  policies: PolicyLike[],
  cfg: CommissionConfig = DEFAULT_COMMISSION_CONFIG,
): HomieResult {
  const totalPremium = sum(policies.map((p) => p.premium));
  const allstateAutoPremium = sum(
    policies.filter(isAllstateAuto).map((p) => p.premium),
  );
  const base = totalPremium - allstateAutoPremium;
  const tier = homieTierFor(base, cfg.homieTiers);
  const tierCommission = base * tier.rate;
  const thresholds = cfg.homieTiers
    .map((t) => t.min)
    .filter((m) => m > 0)
    .sort((a, b) => a - b);
  const nextThreshold = thresholds.find((t) => t > base) ?? null;

  let allstateMonolineItems = 0;
  let allstateBundledItems = 0;
  for (const p of policies) {
    if (!isAllstateBonusEligible(p)) continue;
    const items = Number(p.items ?? 0);
    if (!Number.isFinite(items) || items <= 0) continue;
    if (isBundledReason(p.reason)) allstateBundledItems += items;
    else allstateMonolineItems += items;
  }
  const allstateBonus =
    allstateMonolineItems * cfg.allstateBonusMonoline +
    allstateBundledItems * cfg.allstateBonusBundled;

  const commission = tierCommission + allstateBonus;

  let nextTier: NextTierProjection | null = null;
  if (nextThreshold !== null) {
    const nextTierMeta = cfg.homieTiers.find((t) => t.min === nextThreshold)!;
    const projectedCommission = nextThreshold * nextTierMeta.rate + allstateBonus;
    nextTier = {
      needLabel: `${fmtMoney(nextThreshold - base)} more commissionable premium`,
      tierLabel: `${(nextTierMeta.rate * 100).toFixed(0)}% (${nextTierMeta.label})`,
      projectedCommission,
      delta: projectedCommission - commission,
    };
  }

  return {
    type: "homie",
    totalPremium,
    allstateAutoPremium,
    base,
    tierLabel: tier.label,
    rate: tier.rate,
    tierCommission,
    allstateMonolineItems,
    allstateBundledItems,
    allstateBonus,
    commission,
    nextThreshold,
    nextTier,
  };
}

export function calcAutobot(
  policies: PolicyLike[],
  cfg: CommissionConfig = DEFAULT_COMMISSION_CONFIG,
): AutobotResult {
  const totalPremium = sum(policies.map((p) => p.premium));
  const allstatePolicies = policies.filter(isAllstate);
  const allstatePremium = sum(allstatePolicies.map((p) => p.premium));
  const nonAllstatePremium = totalPremium - allstatePremium;

  const tierItems = allstatePolicies
    .filter((p) => !isExcludedFromTierItems(p))
    .reduce((acc, p) => {
      const n = Number(p.items ?? 0);
      return acc + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0);

  const tierBumps = Math.floor(tierItems / cfg.autobotItemsPerTier);
  const allstateRate = Math.min(
    cfg.autobotBaseRate + cfg.autobotTierStep * tierBumps,
    cfg.autobotTierCap,
  );

  const allstateCommission = allstatePremium * allstateRate;
  const nonAllstateCommission = nonAllstatePremium * cfg.autobotNonAllstateRate;

  let allstateAutoItems = 0;
  let allstateOtherItems = 0;
  for (const p of allstatePolicies) {
    if (!isAllstateBonusEligible(p)) continue;
    const items = Number(p.items ?? 0);
    if (!Number.isFinite(items) || items <= 0) continue;
    if (norm(p.product).includes(AUTO)) allstateAutoItems += items;
    else allstateOtherItems += items;
  }

  let clubBonus = 0;
  let clubLabel: "Club 49" | "Club 38" | null = null;
  if (allstateAutoItems >= cfg.club49.autos && allstateOtherItems >= cfg.club49.others) {
    clubBonus = cfg.club49.bonus;
    clubLabel = "Club 49";
  } else if (allstateAutoItems >= cfg.club38.autos && allstateOtherItems >= cfg.club38.others) {
    clubBonus = cfg.club38.bonus;
    clubLabel = "Club 38";
  }

  const commission = allstateCommission + nonAllstateCommission + clubBonus;

  const itemsToNextTier =
    allstateRate >= cfg.autobotTierCap
      ? 0
      : cfg.autobotItemsPerTier - (tierItems % cfg.autobotItemsPerTier);

  let nextTier: NextTierProjection | null = null;
  if (allstateRate < cfg.autobotTierCap) {
    const nextRate = Math.min(allstateRate + cfg.autobotTierStep, cfg.autobotTierCap);
    const projectedCommission =
      allstatePremium * nextRate + nonAllstateCommission + clubBonus;
    nextTier = {
      needLabel: `${itemsToNextTier} more Allstate item${itemsToNextTier === 1 ? "" : "s"}`,
      tierLabel: `${(nextRate * 100).toFixed(0)}% on Allstate`,
      projectedCommission,
      delta: projectedCommission - commission,
    };
  }

  return {
    type: "autobot",
    totalPremium,
    allstatePremium,
    nonAllstatePremium,
    tierItems,
    allstateRate,
    allstateCommission,
    nonAllstateCommission,
    allstateAutoItems,
    allstateOtherItems,
    clubBonus,
    clubLabel,
    commission,
    itemsToNextTier,
    nextTier,
  };
}

export function calcCommission(
  agentType: AgentType,
  policies: PolicyLike[],
  cfg: CommissionConfig = DEFAULT_COMMISSION_CONFIG,
): CommissionResult {
  if (agentType === "homie") return calcHomie(policies, cfg);
  if (agentType === "service") return calcService(policies, cfg);
  return calcAutobot(policies, cfg);
}

export const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export const fmtPct = (n: number) =>
  `${(n * 100).toFixed(1)}%`;