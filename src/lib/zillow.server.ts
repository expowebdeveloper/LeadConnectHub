import process from "node:process";

export type ZillowParsed = {
  zestimate: number | null;
  rent_zestimate: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lot_sqft: number | null;
  year_built: number | null;
  roof_year: number | null;
  construction_type: string | null;
  last_sold_price: number | null;
  last_sold_date: string | null;
  annual_tax: number | null;
  tax_assessed_value: number | null;
  flood_zone: string | null;
  has_pool: boolean | null;
  photo_url: string | null;
  listing_url: string | null;
};

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function parseZillow(raw: any): ZillowParsed {
  // ScraperAPI's structured Zillow response shape varies; pull common fields defensively.
  const r = raw ?? {};
  const reso = r.resoFacts ?? r.reso_facts ?? {};
  const photos: any[] = Array.isArray(r.photos) ? r.photos : Array.isArray(r.responsivePhotos) ? r.responsivePhotos : [];
  const firstPhoto = photos[0];
  const photoUrl =
    str(firstPhoto?.url) ??
    str(firstPhoto?.mixedSources?.jpeg?.[0]?.url) ??
    str(r.imgSrc) ??
    str(r.hiResImageLink);

  const lastSoldDate =
    str(r.dateSoldString) ?? str(r.lastSoldDate) ?? (r.dateSold ? new Date(r.dateSold * 1000).toISOString().slice(0, 10) : null);

  const taxHistory: any[] = Array.isArray(r.taxHistory) ? r.taxHistory : [];
  const recentTax = taxHistory[0] ?? {};

  return {
    zestimate: num(r.zestimate),
    rent_zestimate: num(r.rentZestimate),
    beds: num(r.bedrooms ?? reso.bedrooms),
    baths: num(r.bathrooms ?? reso.bathrooms),
    sqft: num(r.livingArea ?? reso.livingArea),
    lot_sqft: num(r.lotSize ?? reso.lotSize),
    year_built: num(r.yearBuilt ?? reso.yearBuilt),
    roof_year: num(reso.roofYear ?? reso.roof_year),
    construction_type: str(reso.constructionMaterials ?? reso.construction ?? reso.structureType),
    last_sold_price: num(r.lastSoldPrice ?? r.priceHistory?.[0]?.price),
    last_sold_date: lastSoldDate,
    annual_tax: num(recentTax.taxPaid ?? r.propertyTaxRate),
    tax_assessed_value: num(recentTax.value ?? r.taxAssessedValue),
    flood_zone: str(reso.floodZone ?? r.floodZone),
    has_pool: typeof reso.hasSpaPool === "boolean" ? reso.hasSpaPool : reso.hasPool ?? null,
    photo_url: photoUrl,
    listing_url: str(r.hdpUrl ? `https://www.zillow.com${r.hdpUrl}` : r.url),
  };
}

export async function fetchZillowProperty(address: string): Promise<{ raw: any; parsed: ZillowParsed }> {
  const apiKey = process.env.SCRAPERAPI_KEY;
  if (!apiKey) throw new Error("SCRAPERAPI_KEY is not configured");

  // Build a slugged Zillow URL ("8766-Largo-Mar-Dr-Fort-Myers-FL-33967") and request the
  // rendered page through ScraperAPI's premium (residential) pool so anti-bot doesn't block us.
  const slug = address
    .replace(/,/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
  const zillowUrl = `https://www.zillow.com/homes/${encodeURIComponent(slug)}_rb/`;
  const url =
    `https://api.scraperapi.com/?api_key=${encodeURIComponent(apiKey)}` +
    `&url=${encodeURIComponent(zillowUrl)}` +
    `&country_code=us&render=true&premium=true`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 70_000);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (e) {
    if ((e as any)?.name === "AbortError") {
      throw new Error("Zillow lookup timed out — try Refresh in a moment");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new Error(`ScraperAPI rejected the request (${res.status}) — check the SCRAPERAPI_KEY or plan`);
    }
    if (res.status === 404) {
      throw new Error("Zillow couldn't match this address — check the street/city/zip");
    }
    throw new Error(`ScraperAPI ${res.status}: ${body.slice(0, 200)}`);
  }
  const html = await res.text();
  if (!html || html.length < 500) {
    throw new Error("Zillow returned an empty response — try Refresh again");
  }
  const raw = extractZillowProperty(html);
  if (!raw) {
    throw new Error("Zillow blocked the request or no property found — try Refresh in a few seconds");
  }
  return { raw, parsed: parseZillow(raw) };
}

function extractZillowProperty(html: string): any | null {
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (!m) return null;
  let data: any;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const pageProps = data?.props?.pageProps ?? {};

  // Single-property page: gdpClientCache is a JSON string keyed by query hash.
  const cacheRaw = pageProps?.componentProps?.gdpClientCache ?? pageProps?.gdpClientCache;
  if (cacheRaw) {
    try {
      const cache = typeof cacheRaw === "string" ? JSON.parse(cacheRaw) : cacheRaw;
      for (const key of Object.keys(cache)) {
        const prop = cache[key]?.property ?? cache[key]?.Property;
        if (prop && (prop.zestimate != null || prop.bedrooms != null || prop.address)) {
          return prop;
        }
      }
    } catch {
      // fall through
    }
  }

  // Search-results fallback
  const list =
    pageProps?.searchPageState?.cat1?.searchResults?.listResults ??
    pageProps?.searchPageState?.cat1?.searchResults?.mapResults;
  if (Array.isArray(list) && list.length > 0) return list[0];

  return null;
}

export function normalizeAddressKey(parts: { street?: string | null; city?: string | null; state?: string | null; zip?: string | null }) {
  return [parts.street, parts.city, parts.state, parts.zip]
    .map((p) => String(p ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

export function buildAddressString(parts: { street?: string | null; city?: string | null; state?: string | null; zip?: string | null }) {
  return [parts.street, parts.city, parts.state, parts.zip].map((p) => String(p ?? "").trim()).filter(Boolean).join(", ");
}

function buildPatch(parsed: ZillowParsed) {
  const patch: Record<string, unknown> = {};
  if (parsed.zestimate != null) patch.dwelling_value = parsed.zestimate;
  if (parsed.year_built != null) patch.year_built = parsed.year_built;
  if (parsed.sqft != null) patch.square_feet = parsed.sqft;
  if (parsed.roof_year != null) patch.roof_year = parsed.roof_year;
  if (parsed.construction_type != null) patch.construction_type = parsed.construction_type;
  if (parsed.has_pool != null) patch.has_pool = parsed.has_pool;
  if (parsed.beds != null) patch.num_bedrooms = parsed.beds;
  if (parsed.baths != null) patch.num_bathrooms = parsed.baths;
  return patch;
}

/** Batch-enrich the next N open home-tank list leads with Zillow data. Server-only. */
export async function runZillowListLeadBackfill(limit: number) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: candidates, error } = await supabaseAdmin
    .from("list_leads")
    .select("id,street,city,state,zip")
    .is("archived_at", null)
    .eq("housing_status", "homeowner")
    .is("dwelling_value", null)
    .not("street", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit * 4);
  if (error) throw new Error(error.message);

  const rows = candidates ?? [];
  if (rows.length === 0) return { processed: 0, succeeded: 0, failed: 0, remaining: 0 };

  const ids = rows.map((r) => r.id);
  const { data: cachedRows } = await supabaseAdmin
    .from("zillow_property_data")
    .select("lead_id")
    .eq("source", "list_leads")
    .in("lead_id", ids);
  const cachedSet = new Set((cachedRows ?? []).map((c) => c.lead_id));
  const todo = rows.filter((r) => !cachedSet.has(r.id)).slice(0, limit);

  let succeeded = 0;
  let failed = 0;
  const CONCURRENCY = 3;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const chunk = todo.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (lead) => {
        const address = buildAddressString(lead);
        if (!address || !lead.street) return;
        try {
          const { raw, parsed } = await fetchZillowProperty(address);
          await supabaseAdmin.from("zillow_property_data").upsert(
            {
              lead_id: lead.id,
              source: "list_leads",
              address_key: normalizeAddressKey(lead),
              ...parsed,
              raw,
              fetch_error: null,
              fetched_at: new Date().toISOString(),
            },
            { onConflict: "source,lead_id" },
          );
          const patch = buildPatch(parsed) as never;
          if (Object.keys(patch).length) {
            await supabaseAdmin.from("list_leads").update(patch).eq("id", lead.id);
          }
          succeeded++;
        } catch (e) {
          failed++;
          const message = e instanceof Error ? e.message : String(e);
          await supabaseAdmin.from("zillow_property_data").upsert(
            {
              lead_id: lead.id,
              source: "list_leads",
              address_key: normalizeAddressKey(lead),
              raw: null,
              fetch_error: message,
              fetched_at: new Date().toISOString(),
            },
            { onConflict: "source,lead_id" },
          );
        }
      }),
    );
  }

  const { count: remaining } = await supabaseAdmin
    .from("list_leads")
    .select("id", { count: "exact", head: true })
    .is("archived_at", null)
    .eq("housing_status", "homeowner")
    .is("dwelling_value", null);

  return { processed: todo.length, succeeded, failed, remaining: remaining ?? 0 };
}