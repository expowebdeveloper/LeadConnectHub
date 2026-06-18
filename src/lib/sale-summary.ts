import type { SaleSide } from "@/lib/sale-rows";

export type SaleSummaryEventInput = {
  side: SaleSide;
  items_count?: number | string | null;
  premium?: number | string | null;
  created_at?: string | null;
};

export type LeadSaleSummaryInput = {
  saleEvents: SaleSummaryEventInput[];
};

export function summarizeLeadSale(input: LeadSaleSummaryInput) {
  const eventPremium = input.saleEvents.reduce(
    (sum, event) => sum + (Number(event.premium) || 0),
    0,
  );

  const items = input.saleEvents.reduce(
    (sum, event) => sum + Math.max(1, Number(event.items_count ?? 1) || 1),
    0,
  );

  const policies = input.saleEvents.length;
  const isBundle = new Set(input.saleEvents.map((event) => event.side).filter(Boolean))
    .size >= 2;

  const occurredAt = input.saleEvents.reduce<string | null>((latest, event) => {
    if (!event.created_at) return latest;
    if (!latest) return event.created_at;
    return new Date(event.created_at).getTime() > new Date(latest).getTime()
      ? event.created_at
      : latest;
  }, null);

  return {
    premium: eventPremium,
    items,
    policies,
    isBundle,
    occurredAt,
  };
}

export function summarizeLeadSales(inputs: LeadSaleSummaryInput[]) {
  const rows = inputs.map((input) => summarizeLeadSale(input));
  const premium = rows.reduce((sum, row) => sum + row.premium, 0);
  const items = rows.reduce((sum, row) => sum + row.items, 0);
  const policies = rows.reduce((sum, row) => sum + row.policies, 0);
  const totalLeads = rows.length;
  const bundles = rows.filter((row) => row.isBundle).length;
  const bundleRate = totalLeads ? (bundles / totalLeads) * 100 : 0;

  return {
    premium,
    items,
    policies,
    totalLeads,
    bundles,
    bundleRate,
    rows,
  };
}