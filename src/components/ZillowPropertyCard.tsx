import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, ExternalLink, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getZillowForLead } from "@/lib/zillow.functions";

function fmtMoney(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtNum(n: number | null | undefined, suffix = "") {
  if (n == null) return "—";
  return `${n.toLocaleString()}${suffix}`;
}

function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function ZillowPropertyCard({ leadId, hasAddress }: { leadId: string; hasAddress: boolean }) {
  const qc = useQueryClient();
  const fetchFn = useServerFn(getZillowForLead);
  const q = useQuery({
    queryKey: ["zillow", leadId],
    queryFn: async () => {
      try {
        const result = await fetchFn({ data: { leadId } });
        return result ?? { source: "error" as const, data: null, error: "No response from server" };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Surface as soft error, not a thrown query error, so cached UI still renders.
        return { source: "error" as const, data: null, error: msg };
      }
    },
    enabled: hasAddress,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (!hasAddress) return null;

  const refresh = async () => {
    try {
      await fetchFn({ data: { leadId, force: true } });
    } catch {
      // swallow — query will re-run and capture the error in a structured shape
    }
    qc.invalidateQueries({ queryKey: ["zillow", leadId] });
    qc.invalidateQueries({ queryKey: ["leads"] });
  };

  const row = q.data?.data;
  const err = q.data?.error ?? (q.error instanceof Error ? q.error.message : null);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-2">
          <Home className="h-3 w-3" /> Zillow Property Data
        </div>
        <div className="flex items-center gap-2">
          {row?.listing_url && (
            <a
              href={row.listing_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              View on Zillow <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={refresh} disabled={q.isFetching}>
            <RefreshCw className={`h-3 w-3 mr-1 ${q.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-background/40 backdrop-blur-md p-4">
        {q.isLoading && <p className="text-sm text-muted-foreground">Fetching from Zillow…</p>}
        {!q.isLoading && err && (
          <p className="text-sm text-destructive">Couldn't fetch Zillow data: {err}</p>
        )}
        {!q.isLoading && !err && !row && (
          <p className="text-sm text-muted-foreground">No data yet.</p>
        )}
        {row && !row.fetch_error && (
          <div className="flex gap-4">
            {row.photo_url && (
              <img
                src={row.photo_url}
                alt="Property"
                className="h-28 w-40 rounded-lg object-cover border border-border/60 flex-shrink-0"
                loading="lazy"
              />
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-sm flex-1">
              <Stat label="Zestimate" value={fmtMoney(row.zestimate)} highlight />
              <Stat label="Rent Zestimate" value={fmtMoney(row.rent_zestimate)} />
              <Stat label="Year built" value={row.year_built ?? "—"} />
              <Stat label="Sq ft" value={fmtNum(row.sqft)} />
              <Stat label="Lot" value={fmtNum(row.lot_sqft, " sqft")} />
              <Stat label="Beds / Baths" value={`${row.beds ?? "—"} / ${row.baths ?? "—"}`} />
              <Stat label="Roof year" value={row.roof_year ?? "—"} />
              <Stat label="Construction" value={row.construction_type ?? "—"} />
              <Stat label="Flood zone" value={row.flood_zone ?? "—"} />
              <Stat label="Has pool" value={row.has_pool == null ? "—" : row.has_pool ? "Yes" : "No"} />
              <Stat
                label="Last sold"
                value={
                  row.last_sold_price || row.last_sold_date
                    ? `${fmtMoney(row.last_sold_price)}${row.last_sold_date ? ` · ${row.last_sold_date}` : ""}`
                    : "—"
                }
              />
              <Stat label="Annual tax" value={fmtMoney(row.annual_tax)} />
            </div>
          </div>
        )}
        <div className="mt-3 text-[11px] text-muted-foreground">
          Source: Zillow via ScraperAPI{row?.fetched_at ? ` · updated ${timeAgo(row.fetched_at)}` : ""}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">{label}</div>
      <div className={`tabular-nums ${highlight ? "text-base font-semibold" : "text-sm"}`}>{value}</div>
    </div>
  );
}