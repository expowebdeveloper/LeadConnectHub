import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SearchHit = {
  id: string;
  source: "live" | "list";
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  dispo: string | null;
  vendor_id: string;
  vendor_name: string | null;
  claimed_by: string | null;
  claimed_by_name: string | null;
  claimed_by_avatar_url: string | null;
  list_type: string | null;
  created_at: string;
};

/** Global lead search. Honors RLS via the user's Supabase client. */
export const searchLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        q: z.string().trim().min(2).max(100),
        limit: z.number().int().min(1).max(100).default(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const raw = data.q.trim();
    // Strip non-alphanumerics for phone matching.
    const phoneDigits = raw.replace(/\D+/g, "");
    const escape = (s: string) => s.replace(/[%_,()]/g, (m) => `\\${m}`);
    // Split into whitespace tokens so "ethel walker" matches first+last across columns.
    const tokens = raw.split(/\s+/).filter((t) => t.length > 0);
    const buildOrForToken = (tok: string): string[] => {
      const like = `%${escape(tok)}%`;
      const parts = [
        `first_name.ilike.${like}`,
        `last_name.ilike.${like}`,
        `email.ilike.${like}`,
        `city.ilike.${like}`,
        `zip.ilike.${like}`,
      ];
      const digits = tok.replace(/\D+/g, "");
      if (digits.length >= 3) parts.push(`phone.ilike.%${digits}%`);
      return parts;
    };
    // Also include the full raw string for single-column matches (email, city, etc).
    const fullLike = `%${escape(raw)}%`;
    const fullParts = [
      `email.ilike.${fullLike}`,
      `city.ilike.${fullLike}`,
      `zip.ilike.${fullLike}`,
    ];
    if (phoneDigits.length >= 3) {
      fullParts.push(`phone.ilike.%${phoneDigits}%`);
    }
    const cols =
      "id, first_name, last_name, phone, email, city, state, zip, dispo, vendor_id, claimed_by, created_at";

    void fullParts;
    let liveQ = supabase.from("leads").select(cols);
    let listQ = supabase.from("list_leads").select(cols + ", list_type");
    // Multiple .or() calls are AND'd together by PostgREST. Each token must
    // match SOME column, allowing "ethel walker" to match first+last across rows.
    for (const tok of tokens) {
      const orExpr = buildOrForToken(tok).join(",");
      liveQ = liveQ.or(orExpr);
      listQ = listQ.or(orExpr);
    }
    const [liveRes, listRes] = await Promise.all([
      liveQ.order("created_at", { ascending: false }).limit(data.limit),
      listQ.order("created_at", { ascending: false }).limit(data.limit),
    ]);
    if (liveRes.error) throw new Error(liveRes.error.message);
    if (listRes.error) throw new Error(listRes.error.message);

    const rows: SearchHit[] = [];
    for (const r of (liveRes.data ?? []) as unknown as Array<
      Record<string, unknown>
    >) {
      rows.push({
        id: String(r.id),
        source: "live",
        first_name: (r.first_name as string | null) ?? null,
        last_name: (r.last_name as string | null) ?? null,
        phone: (r.phone as string | null) ?? null,
        email: (r.email as string | null) ?? null,
        city: (r.city as string | null) ?? null,
        state: (r.state as string | null) ?? null,
        zip: (r.zip as string | null) ?? null,
        dispo: (r.dispo as string | null) ?? null,
        vendor_id: String(r.vendor_id),
        vendor_name: null,
        claimed_by: (r.claimed_by as string | null) ?? null,
        claimed_by_name: null,
        claimed_by_avatar_url: null,
        list_type: null,
        created_at: String(r.created_at),
      });
    }
    for (const r of (listRes.data ?? []) as unknown as Array<
      Record<string, unknown>
    >) {
      rows.push({
        id: String(r.id),
        source: "list",
        first_name: (r.first_name as string | null) ?? null,
        last_name: (r.last_name as string | null) ?? null,
        phone: (r.phone as string | null) ?? null,
        email: (r.email as string | null) ?? null,
        city: (r.city as string | null) ?? null,
        state: (r.state as string | null) ?? null,
        zip: (r.zip as string | null) ?? null,
        dispo: (r.dispo as string | null) ?? null,
        vendor_id: String(r.vendor_id),
        vendor_name: null,
        claimed_by: (r.claimed_by as string | null) ?? null,
        claimed_by_name: null,
        claimed_by_avatar_url: null,
        list_type: (r.list_type as string | null) ?? null,
        created_at: String(r.created_at),
      });
    }

    // Resolve vendor and claimer names in one shot.
    const ids = Array.from(
      new Set(
        rows
          .flatMap((r) => [r.vendor_id, r.claimed_by])
          .filter((x): x is string => !!x),
      ),
    );
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, company_name, email, avatar_url")
        .in("id", ids);
      const map = new Map<
        string,
        { vendor_name: string; agent_name: string; avatar_url: string | null }
      >(
        (profs ?? []).map((p) => [
          p.id,
          {
            vendor_name: p.company_name || p.full_name || p.email || "",
            agent_name: p.full_name || p.company_name || p.email || "",
            avatar_url: (p as { avatar_url: string | null }).avatar_url ?? null,
          },
        ]),
      );
      for (const r of rows) {
        r.vendor_name = map.get(r.vendor_id)?.vendor_name ?? null;
        if (r.claimed_by) {
          const c = map.get(r.claimed_by);
          r.claimed_by_name = c?.agent_name ?? null;
          r.claimed_by_avatar_url = c?.avatar_url ?? null;
        }
      }
    }

    // Rank by relevance to the query. Tiers are spaced so a higher tier
    // always beats any combination of lower tiers:
    //   phone exact         100000
    //   phone partial        50000
    //   full two-word name   20000
    //   last-name exact      10000   (last name > first name)
    //   first-name exact      6000
    //   last-name prefix      4000
    //   first-name prefix     2400
    //   last-name contains    1500
    //   first-name contains    900
    const qLower = raw.toLowerCase();
    const qWords = qLower.split(/\s+/).filter(Boolean);
    const qDigits = phoneDigits;
    const scoreHit = (r: SearchHit): number => {
      const fn = (r.first_name ?? "").toLowerCase();
      const ln = (r.last_name ?? "").toLowerCase();
      const full = `${fn} ${ln}`.trim();
      const phone = (r.phone ?? "").replace(/\D+/g, "");
      let s = 0;
      if (qDigits.length >= 7) {
        if (phone === qDigits) s += 100000;
        else if (phone.includes(qDigits)) s += 50000;
      }
      if (qWords.length >= 2) {
        const [a, b] = qWords;
        if ((fn === a && ln === b) || (fn === b && ln === a)) s += 20000;
        else if (
          (fn.includes(a) && ln.includes(b)) ||
          (fn.includes(b) && ln.includes(a))
        ) s += 15000;
      }
      if (full && full === qLower) s += 18000;
      for (const w of qWords) {
        if (!w) continue;
        if (ln === w) s += 10000;
        else if (ln.startsWith(w)) s += 4000;
        else if (ln.includes(w)) s += 1500;
        if (fn === w) s += 6000;
        else if (fn.startsWith(w)) s += 2400;
        else if (fn.includes(w)) s += 900;
      }
      return s;
    };
    rows.sort((a, b) => {
      const diff = scoreHit(b) - scoreHit(a);
      if (diff !== 0) return diff;
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
    return rows.slice(0, data.limit);
  });

export type RecentClaimInfo = {
  claimed_by: string | null;
  claimed_by_name: string | null;
  claimed_by_avatar_url: string | null;
  dispo: string | null;
};

/**
 * Refresh claim/agent info for a small set of cached recent leads.
 * Returns a map keyed by `${source}:${id}` so callers can merge live
 * agent name + avatar over stale localStorage values.
 */
export const getRecentLeadsClaimInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        ids: z
          .array(
            z.object({
              id: z.string().uuid(),
              source: z.enum(["live", "list"]),
            }),
          )
          .max(20),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const out: Record<string, RecentClaimInfo> = {};
    if (data.ids.length === 0) return out;

    const liveIds = data.ids.filter((x) => x.source === "live").map((x) => x.id);
    const listIds = data.ids.filter((x) => x.source === "list").map((x) => x.id);
    const claimerIds = new Set<string>();
    const rows: Array<{ key: string; claimed_by: string | null; dispo: string | null }> = [];

    if (liveIds.length > 0) {
      const { data: live } = await supabase
        .from("leads")
        .select("id, claimed_by, dispo")
        .in("id", liveIds);
      for (const r of live ?? []) {
        rows.push({ key: `live:${r.id}`, claimed_by: r.claimed_by, dispo: r.dispo });
        if (r.claimed_by) claimerIds.add(r.claimed_by);
      }
    }
    if (listIds.length > 0) {
      const { data: list } = await supabase
        .from("list_leads")
        .select("id, claimed_by, dispo")
        .in("id", listIds);
      for (const r of list ?? []) {
        rows.push({ key: `list:${r.id}`, claimed_by: r.claimed_by, dispo: r.dispo });
        if (r.claimed_by) claimerIds.add(r.claimed_by);
      }
    }

    const profMap = new Map<string, { name: string; avatar_url: string | null }>();
    if (claimerIds.size > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, company_name, email, avatar_url")
        .in("id", Array.from(claimerIds));
      for (const p of profs ?? []) {
        profMap.set(p.id, {
          name: p.full_name || p.company_name || p.email || "",
          avatar_url: (p as { avatar_url: string | null }).avatar_url ?? null,
        });
      }
    }

    for (const r of rows) {
      const c = r.claimed_by ? profMap.get(r.claimed_by) : undefined;
      out[r.key] = {
        claimed_by: r.claimed_by,
        claimed_by_name: c?.name ?? null,
        claimed_by_avatar_url: c?.avatar_url ?? null,
        dispo: r.dispo,
      };
    }
    return out;
  });