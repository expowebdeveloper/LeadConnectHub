import { createServerFn } from "@tanstack/react-start";

// Public: returns the distinct list of existing vendor company names so new
// signups can attach themselves to an existing vendor instead of creating a
// duplicate. We fuzzy-merge look-alike names (case/punctuation/suffix) and
// surface the most common spelling for each group.
export const listVendorCompanies = createServerFn({ method: "GET" }).handler(
  async () => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: vendorRoleRows, error: rolesErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "vendor");
    if (rolesErr) throw new Error(rolesErr.message);

    const vendorIds = (vendorRoleRows ?? []).map((r) => r.user_id);
    if (vendorIds.length === 0) return { companies: [] as string[] };

    const { data: profiles, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("company_name, full_name")
      .in("id", vendorIds);
    if (profErr) throw new Error(profErr.message);

    const normalize = (raw: string) =>
      raw
        .toLowerCase()
        .replace(/[\p{P}\p{S}]/gu, " ")
        .replace(
          /\b(inc|llc|ltd|corp|co|company|the|group|agency|insurance|ins)\b/g,
          " ",
        )
        .replace(/\s+/g, " ")
        .trim();

    const groups = new Map<string, Map<string, number>>();
    for (const p of profiles ?? []) {
      const label = (p.company_name || p.full_name || "").trim();
      if (!label) continue;
      const key = normalize(label);
      if (!key) continue;
      const labelCounts = groups.get(key) ?? new Map();
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
      groups.set(key, labelCounts);
    }

    const companies = Array.from(groups.values())
      .map(
        (labelCounts) =>
          Array.from(labelCounts.entries()).sort((a, b) => b[1] - a[1])[0][0],
      )
      .sort((a, b) => a.localeCompare(b));

    return { companies };
  },
);