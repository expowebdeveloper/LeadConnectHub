export type AutoSaleMetricInput = {
  auto_motor_club_premium?: number | null;
  auto_policies_count?: number | null;
  num_vehicles?: number | null;
  quoted_premium?: number | null;
};

export function computeAutoSaleMetrics(lead: AutoSaleMetricInput) {
  const items = Math.max(
    1,
    Number(lead.num_vehicles ?? lead.auto_policies_count ?? 1) || 1,
  );
  const premium =
    (Number(lead.quoted_premium ?? 0) || 0) +
    (Number(lead.auto_motor_club_premium ?? 0) || 0);

  return { items, premium };
}