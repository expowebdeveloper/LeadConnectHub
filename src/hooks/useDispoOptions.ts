import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listDispoOptions, type DispoOption } from "@/lib/dispos.functions";
import { DISPO_OPTIONS as DEFAULT_DISPOS } from "@/lib/constants";

// Fallback list (used during initial load) — mirrors the seeded rows.
const FALLBACK: DispoOption[] = DEFAULT_DISPOS.map((d, i) => ({
  value: d.value,
  label: d.label,
  sort_order: (i + 1) * 10,
  enabled: true,
  is_system: true,
}));

export function useDispoOptions() {
  const fetch = useServerFn(listDispoOptions);
  const q = useQuery({
    queryKey: ["dispo-options"],
    queryFn: () => fetch(),
    staleTime: 5 * 60 * 1000,
  });
  const all = q.data ?? FALLBACK;
  const enabled = all.filter((d) => d.enabled);
  const labelMap = new Map(all.map((d) => [d.value, d.label]));
  const labelOf = (v: string | null | undefined) =>
    (v && labelMap.get(v)) || v || "";
  return { all, options: enabled, labelOf, isLoading: q.isLoading };
}