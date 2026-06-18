// Direct links to county property appraiser / assessor sites.
// Keyed as `${stateAbbrev}:${normalizedCountyName}`.
// County name is lowercased, "county" suffix stripped, punctuation removed.
//
// Two helpers are exported:
//   - getCountyAssessorUrl(state, county) — homepage URL (back-compat)
//   - getCountyAssessorSearchUrl(state, county, addr) — deep search URL,
//     with the property address preloaded when the county's site supports
//     URL params. Falls back to the search page (or homepage) otherwise.

export function normalizeCountyKey(state?: string | null, county?: string | null): string | null {
  if (!state || !county) return null;
  const s = String(state).trim().toUpperCase();
  const c = String(county)
    .toLowerCase()
    .replace(/\bcounty\b/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || !c) return null;
  return `${s}:${c}`;
}

export type ParsedStreet = { number: string; name: string };

/**
 * Split a free-form street string like "1234 N Main St Apt 2" into a
 * street number and the remainder. Best-effort: if no leading number,
 * `number` is empty and the whole string is treated as the name.
 */
export function parseStreet(street?: string | null): ParsedStreet {
  const s = String(street ?? "").trim();
  if (!s) return { number: "", name: "" };
  const m = s.match(/^\s*(\d+[A-Za-z]?)\s+(.+?)\s*$/);
  if (m) return { number: m[1], name: m[2] };
  return { number: "", name: s };
}

export type AssessorAddress = {
  street?: string | null;
  city?: string | null;
  zip?: string | null;
};

export type AssessorSearchResult = {
  /** The URL to open in a new tab. */
  url: string;
  /** True when the address is preloaded into the search via URL params. */
  preloaded: boolean;
  /** "direct" = points at a search page on the assessor's site, "homepage" = generic landing, "fallback" = search engine. */
  source: "direct" | "homepage" | "fallback";
};

type Builder = (addr: AssessorAddress) => AssessorSearchResult;

function enc(v: string | null | undefined): string {
  return encodeURIComponent(String(v ?? "").trim());
}

function fullAddress(addr: AssessorAddress): string {
  const parts = [addr.street, addr.city, addr.zip].map((p) => (p ?? "").toString().trim()).filter(Boolean);
  return parts.join(", ");
}

// Florida — all 67 county property appraisers.
const FL_HOMEPAGES: Record<string, string> = {
  alachua: "https://www.acpafl.org/",
  baker: "https://www.bakerpa.com/",
  bay: "https://www.baypa.net/",
  bradford: "https://www.bradfordappraiser.com/",
  brevard: "https://www.bcpao.us/",
  broward: "https://web.bcpa.net/bcpaclient/",
  calhoun: "https://www.calhounpa.net/",
  charlotte: "https://www.ccappraiser.com/",
  citrus: "https://www.pa.citrus.fl.us/",
  clay: "https://www.ccpao.com/",
  collier: "https://www.collierappraiser.com/",
  columbia: "https://www.columbia.floridapa.com/",
  desoto: "https://www.desotopa.com/",
  "de soto": "https://www.desotopa.com/",
  dixie: "https://www.dixiepa.com/",
  duval: "https://paopropertysearch.coj.net/",
  escambia: "https://www.escpa.org/",
  flagler: "https://www.flaglerpa.com/",
  franklin: "https://www.franklincountypa.net/",
  gadsden: "https://www.gadsdenpa.com/",
  gilchrist: "https://www.gilchrist.floridapa.com/",
  glades: "https://www.gladespa.com/",
  gulf: "https://www.gulfpa.com/",
  hamilton: "https://www.hamiltonpa.com/",
  hardee: "https://www.hardeepa.com/",
  hendry: "https://www.hendryprop.com/",
  hernando: "https://www.hernandopa-fl.us/",
  highlands: "https://www.hcpao.org/",
  hillsborough: "https://www.hcpafl.org/",
  holmes: "https://www.holmespa.org/",
  "indian river": "https://www.ircpa.org/",
  jackson: "https://www.jacksoncountypa.net/",
  jefferson: "https://www.jeffersonpa.net/",
  lafayette: "https://www.lafayettepa.com/",
  lake: "https://www.lakecopropappr.com/",
  lee: "https://www.leepa.org/",
  leon: "https://www.leonpa.gov/",
  levy: "https://www.levypa.com/",
  liberty: "https://www.libertypa.org/",
  madison: "https://www.madisonpa.com/",
  manatee: "https://www.manateepao.gov/",
  marion: "https://www.pa.marion.fl.us/",
  martin: "https://www.pa.martin.fl.us/",
  "miami-dade": "https://www.miamidade.gov/pa/",
  "miami dade": "https://www.miamidade.gov/pa/",
  monroe: "https://www.mcpafl.org/",
  nassau: "https://www.nassauflpa.com/",
  okaloosa: "https://www.okaloosapa.com/",
  okeechobee: "https://www.okeechobeepa.com/",
  orange: "https://www.ocpafl.org/",
  osceola: "https://www.property-appraiser.org/",
  "palm beach": "https://www.pbcpao.gov/",
  pasco: "https://www.pascopa.com/",
  pinellas: "https://www.pcpao.gov/",
  polk: "https://www.polkpa.org/",
  putnam: "https://www.pa.putnam-fl.com/",
  "santa rosa": "https://www.srcpa.gov/",
  sarasota: "https://www.sc-pa.com/",
  seminole: "https://www.scpafl.org/",
  "st johns": "https://www.sjcpa.us/",
  "st. johns": "https://www.sjcpa.us/",
  "saint johns": "https://www.sjcpa.us/",
  "st lucie": "https://www.paslc.gov/",
  "st. lucie": "https://www.paslc.gov/",
  "saint lucie": "https://www.paslc.gov/",
  sumter: "https://www.sumterpa.com/",
  suwannee: "https://www.suwanneepa.com/",
  taylor: "https://www.taylorpa.com/",
  union: "https://www.unionpa.com/",
  volusia: "https://vcpa.vcgov.org/",
  wakulla: "https://www.mywakullapa.com/",
  walton: "https://www.waltonpa.com/",
  washington: "https://www.washingtonflpa.com/",
};

// Deep-link builders for counties where we have a confirmed URL pattern that
// preloads the address into the assessor's search. Counties not listed here
// fall back to the homepage URL above.
const FL_SEARCH: Record<string, Builder> = {
  // Broward BCPA — hash-routed SPA, supports `adr` query param
  broward: (a) => ({
    url: `https://web.bcpa.net/BcpaClient/#/Record-Search?adr=${enc(a.street)}`,
    preloaded: !!a.street,
    source: "direct",
  }),

  // Pinellas PCPAO — quick search
  pinellas: (a) => ({
    url: `https://www.pcpao.gov/quick-search?address=${enc(a.street)}`,
    preloaded: !!a.street,
    source: "direct",
  }),

  // Miami-Dade — SPA hash route with address param
  "miami-dade": (a) => ({
    url: `https://www.miamidade.gov/Apps/PA/propertysearch/#/?address=${enc(a.street)}`,
    preloaded: !!a.street,
    source: "direct",
  }),
  "miami dade": (a) => ({
    url: `https://www.miamidade.gov/Apps/PA/propertysearch/#/?address=${enc(a.street)}`,
    preloaded: !!a.street,
    source: "direct",
  }),

  // Hillsborough HCPAFL — SPA hash route
  hillsborough: (a) => ({
    url: `https://gis.hcpafl.org/propertysearch/#/nav/Search?searchTerm=${enc(a.street)}`,
    preloaded: !!a.street,
    source: "direct",
  }),

  // Lee LeePA — classic ASP.NET form, accepts StNum / StName
  lee: (a) => {
    const { number, name } = parseStreet(a.street);
    return {
      url: `https://www.leepa.org/Search/PropertySearch.aspx?Type=Address&StNum=${enc(number)}&StName=${enc(name)}`,
      preloaded: !!(number || name),
      source: "direct",
    };
  },

  // Palm Beach PBCPAO
  "palm beach": (a) => ({
    url: `https://pbcpao.gov/Property/Search?address=${enc(a.street)}`,
    preloaded: !!a.street,
    source: "direct",
  }),

  // Brevard BCPAO — SPA hash route
  brevard: (a) => ({
    url: `https://www.bcpao.us/PropertySearch/#/nav/Search?propertyAddress=${enc(a.street)}`,
    preloaded: !!a.street,
    source: "direct",
  }),

  // Sarasota SC-PA
  sarasota: (a) => ({
    url: `https://www.sc-pa.com/propertysearch/?address=${enc(a.street)}`,
    preloaded: !!a.street,
    source: "direct",
  }),

  // Duval / Jacksonville — search page (form-based; opens search UI directly)
  duval: (a) => ({
    url: `https://paopropertysearch.coj.net/Basic/Search.aspx?searchtype=address&address=${enc(a.street)}`,
    preloaded: !!a.street,
    source: "direct",
  }),

  // Orange OCPAFL — parcel search page (form-based, no URL params)
  orange: () => ({
    url: `https://ocpaweb.ocpafl.org/parcelsearch`,
    preloaded: false,
    source: "direct",
  }),

  // Polk PA — search page
  polk: () => ({
    url: `https://www.polkpa.org/CamaDisplay.aspx?OutputMode=Input&SearchType=RealEstate`,
    preloaded: false,
    source: "direct",
  }),
};

const DIRECT_LOOKUP: Record<string, Record<string, string>> = { FL: FL_HOMEPAGES };
const SEARCH_LOOKUP: Record<string, Record<string, Builder>> = { FL: FL_SEARCH };

/**
 * Returns the direct assessor / property appraiser URL for a county, or null
 * if we don't have one on file (caller should fall back to a search query).
 */
export function getCountyAssessorUrl(state?: string | null, county?: string | null): string | null {
  const key = normalizeCountyKey(state, county);
  if (!key) return null;
  const [s, c] = key.split(":");
  const table = DIRECT_LOOKUP[s];
  if (!table) return null;
  return table[c] ?? null;
}

/**
 * Returns a deep-link to the county appraiser's address-search page with
 * the address preloaded when supported. Falls back to the homepage URL
 * when the county has no known search pattern, and returns null when we
 * have nothing for that county at all (caller should use a search engine).
 */
export function getCountyAssessorSearchUrl(
  state?: string | null,
  county?: string | null,
  addr?: AssessorAddress,
): AssessorSearchResult | null {
  const key = normalizeCountyKey(state, county);
  if (!key) return null;
  const [s, c] = key.split(":");
  const searchTable = SEARCH_LOOKUP[s];
  const builder = searchTable?.[c];
  if (builder && addr) {
    return builder(addr);
  }
  const home = DIRECT_LOOKUP[s]?.[c];
  if (home) {
    return { url: home, preloaded: false, source: "homepage" };
  }
  return null;
}