import { computeAutoSaleMetrics } from "@/lib/sale-metrics";

export type LeadLineInput = {
  claimed_by?: string | null;
  dispo?: string | null;
  items?: number | string | null;
  quoted_premium?: number | string | null;
  sold_at?: string | null;
  type?: string | null;
};

export type LeadSaleInput = {
  id: string;
  updated_at?: string | null;
  created_at?: string | null;
  dispo?: string | null;
  claimed_by?: string | null;
  quoted_premium?: number | null;
  auto_motor_club_premium?: number | null;
  auto_policies_count?: number | null;
  num_vehicles?: number | null;
  home_dispo?: string | null;
  home_claimed_by?: string | null;
  home_quoted_premium?: number | null;
  home_policies_count?: number | null;
  lead_lines?: unknown;
};

export type SaleSide =
  | "auto"
  | "home"
  | "motorcycle"
  | "boat"
  | "umbrella"
  | "flood"
  | "golf_cart"
  | "rv";

export type CanonicalSaleRow = {
  leadId: string;
  ownerId: string;
  side: SaleSide;
  items: number;
  premium: number;
  occurredAt: string | null;
};

export function isSoldDispo(value: string | null | undefined): boolean {
  return String(value ?? "").trim().toLowerCase() === "sold";
}

/**
 * Canonical per-lead sale-row builder. Both the dashboard (analytics) and the
 * agent details panel derive their totals from this function so the two views
 * can never drift.
 */
export function buildLeadSaleRows(lead: LeadSaleInput): CanonicalSaleRow[] {
  const rows: CanonicalSaleRow[] = [];
  const occurredAt = lead.updated_at ?? lead.created_at ?? null;

  if (isSoldDispo(lead.dispo) && lead.claimed_by) {
    const m = computeAutoSaleMetrics(lead);
    rows.push({
      leadId: lead.id,
      ownerId: lead.claimed_by,
      side: "auto",
      items: m.items,
      premium: m.premium,
      occurredAt,
    });
  }

  if (isSoldDispo(lead.home_dispo) && lead.home_claimed_by) {
    rows.push({
      leadId: lead.id,
      ownerId: lead.home_claimed_by,
      side: "home",
      items: Math.max(1, Number(lead.home_policies_count ?? 1) || 1),
      premium: Number(lead.home_quoted_premium ?? 0) || 0,
      occurredAt,
    });
  }

  const lines = Array.isArray(lead.lead_lines)
    ? (lead.lead_lines as LeadLineInput[])
    : [];
  for (const line of lines) {
    if (!isSoldDispo(line?.dispo) || !line?.claimed_by) continue;
    const items = Number(line.items ?? 1);
    const side: SaleSide =
      line.type === "boat" ||
      line.type === "umbrella" ||
      line.type === "flood" ||
      line.type === "golf_cart" ||
      line.type === "rv" ||
      line.type === "home" ||
      line.type === "auto"
        ? (line.type as SaleSide)
        : "motorcycle";
    rows.push({
      leadId: lead.id,
      ownerId: line.claimed_by,
      side,
      items: Math.max(1, Number.isFinite(items) ? items : 1),
      premium: Number(line.quoted_premium ?? 0) || 0,
      occurredAt: line.sold_at ?? occurredAt,
    });
  }

  return rows;
}