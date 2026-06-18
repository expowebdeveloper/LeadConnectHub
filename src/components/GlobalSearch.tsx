import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search as SearchIcon, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AgentAvatar } from "@/components/AgentAvatar";
import { searchLeads, getRecentLeadsClaimInfo, type SearchHit } from "@/lib/search.functions";
import { useAuth, useHasRole } from "@/lib/auth";

const RECENTS_KEY = "leadvault.recentLeads";
const RECENTS_MAX = 7;

type RecentLead = Pick<
  SearchHit,
  "id" | "source" | "first_name" | "last_name" | "phone" | "city" | "state" | "zip"
> & {
  list_type?: string | null;
  dispo?: string | null;
  claimed_by?: string | null;
  claimed_by_name?: string | null;
  claimed_by_avatar_url?: string | null;
};

function loadRecents(): RecentLead[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x === "object" && typeof x.id === "string" && (x.source === "live" || x.source === "list"))
      .slice(0, RECENTS_MAX) as RecentLead[];
  } catch {
    return [];
  }
}

function saveRecents(list: RecentLead[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX)));
  } catch {
    /* ignore */
  }
}

function toRecent(r: SearchHit): RecentLead {
  return {
    id: r.id,
    source: r.source,
    first_name: r.first_name,
    last_name: r.last_name,
    phone: r.phone,
    city: r.city,
    state: r.state,
    zip: r.zip,
    list_type: r.list_type,
    dispo: r.dispo,
    claimed_by: r.claimed_by,
    claimed_by_name: r.claimed_by_name,
    claimed_by_avatar_url: r.claimed_by_avatar_url,
  };
}

/**
 * Universal lead search shown in the app header on every page.
 * Searches all leads in the system (live + list) via the searchLeads
 * server fn and shows results in an inline dropdown so the user stays
 * on the current page. Selecting a result navigates to the lead.
 */
export function GlobalSearch({ placeholder }: { placeholder?: string } = {}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isVendor = useHasRole("vendor");
  const fetchSearch = useServerFn(searchLeads);
  const fetchRecentClaims = useServerFn(getRecentLeadsClaimInfo);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [recents, setRecents] = useState<RecentLead[]>([]);

  useEffect(() => {
    setRecents(loadRecents());
  }, []);

  const pushRecent = useCallback((lead: RecentLead) => {
    const key = `${lead.source}:${lead.id}`;
    setRecents((prev) => {
      const next = [lead, ...prev.filter((x) => `${x.source}:${x.id}` !== key)].slice(0, RECENTS_MAX);
      saveRecents(next);
      return next;
    });
  }, []);

  const removeRecent = useCallback((key: string) => {
    setRecents((prev) => {
      const next = prev.filter((x) => `${x.source}:${x.id}` !== key);
      saveRecents(next);
      return next;
    });
  }, []);

  const clearRecents = useCallback(() => {
    setRecents([]);
    saveRecents([]);
  }, []);

  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const enabled = debounced.length >= 2;
  const resultsQ = useQuery({
    queryKey: ["global-lead-search", debounced],
    queryFn: () => fetchSearch({ data: { q: debounced, limit: 20 } }),
    enabled,
    staleTime: 15_000,
  });

  const rows = useMemo<SearchHit[]>(() => resultsQ.data ?? [], [resultsQ.data]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const navigateToLead = useCallback((r: RecentLead) => {
    if (isVendor) {
      navigate({ to: "/leads/$leadId", params: { leadId: r.id }, search: { source: r.source } });
      return;
    }
    const mine = !!user?.id && r.claimed_by === user.id;
    if (mine) {
      const sourceKey = r.source === "live" ? "leads" : "list_leads";
      navigate({ to: "/my-leads", search: { openLead: `${sourceKey}:${r.id}` } });
      return;
    }
    if (r.source === "list") {
      navigate({ to: "/shark-tank", search: { lead: r.id } });
      return;
    }
    navigate({ to: "/leads/$leadId", params: { leadId: r.id }, search: { source: r.source } });
  }, [isVendor, navigate, user?.id]);

  const go = (r: SearchHit) => {
    setOpen(false);
    pushRecent(toRecent(r));
    navigateToLead(toRecent(r));
  };

  const goRecent = (r: RecentLead) => {
    setOpen(false);
    pushRecent(r);
    navigateToLead(r);
  };

  const showRecents = open && !enabled && recents.length > 0;

  // Refresh agent claim/avatar for cached recents — localStorage values go
  // stale as soon as a lead is (re)claimed by another agent.
  const recentIds = useMemo(
    () => recents.map((r) => ({ id: r.id, source: r.source })),
    [recents],
  );
  const recentKey = useMemo(
    () => recentIds.map((x) => `${x.source}:${x.id}`).join(","),
    [recentIds],
  );
  const recentClaimsQ = useQuery({
    queryKey: ["global-search-recent-claims", recentKey],
    queryFn: () => fetchRecentClaims({ data: { ids: recentIds } }),
    enabled: showRecents && recentIds.length > 0,
    staleTime: 30_000,
  });
  const liveRecents = useMemo<RecentLead[]>(() => {
    const info = recentClaimsQ.data;
    if (!info) return recents;
    return recents.map((r) => {
      const live = info[`${r.source}:${r.id}`];
      if (!live) return r;
      return {
        ...r,
        claimed_by: live.claimed_by,
        claimed_by_name: live.claimed_by_name,
        claimed_by_avatar_url: live.claimed_by_avatar_url,
        dispo: live.dispo ?? r.dispo,
      };
    });
  }, [recents, recentClaimsQ.data]);

  // Persist refreshed values so the next render is correct before the
  // background query resolves.
  useEffect(() => {
    if (!recentClaimsQ.data) return;
    saveRecents(liveRecents);
  }, [recentClaimsQ.data, liveRecents]);

  return (
    <div ref={containerRef} className="relative w-full sm:w-80 md:w-[28rem] lg:w-[32rem]">
      <div className="flex h-10 items-center gap-2 rounded-xl border border-border bg-background/60 pr-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/40">
        <button
          type="button"
          aria-label="Search"
          onClick={() => {
            if (rows[0]) { go(rows[0]); return; }
            inputRef.current?.focus();
            setOpen(true);
          }}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-l-xl bg-brand text-brand-foreground transition hover:opacity-90"
        >
          <SearchIcon className="h-4 w-4" />
        </button>
        <Input
          ref={inputRef}
          type="search"
          name="lv-global-search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-autocomplete="list"
          data-form-type="other"
          data-lpignore="true"
          data-1p-ignore="true"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder ?? "Search"}
          className="h-8 flex-1 border-0 bg-transparent px-0 text-center text-sm placeholder:text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          onKeyDown={(e) => {
            if (e.key === "Escape") { setQ(""); setOpen(false); }
            if (e.key === "Enter") {
              if (rows[0]) { e.preventDefault(); go(rows[0]); }
            }
          }}
        />
      </div>
      {showRecents && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent leads</span>
            <button
              type="button"
              onClick={clearRecents}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
          <ul className="divide-y divide-border/50">
            {liveRecents.map((r) => {
              const key = `${r.source}:${r.id}`;
              const name = ((r.first_name ?? "") + " " + (r.last_name ?? "")).trim() || "—";
              return (
                <li
                  key={key}
                  role="button"
                  tabIndex={0}
                  onClick={() => goRecent(r)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goRecent(r); } }}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{name}</span>
                      {r.source === "live" ? (
                        <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/40 px-1.5 py-0 text-[10px] uppercase">Live</Badge>
                      ) : (
                        <Badge variant="outline" className="border-cyan-500/40 text-cyan-300 px-1.5 py-0 text-[10px] uppercase">{r.list_type || "List"}</Badge>
                      )}
                      {r.dispo && (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] uppercase">{r.dispo}</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {r.phone ?? "—"}
                      {" · "}
                      {[r.city, r.state, r.zip].filter(Boolean).join(", ") || "—"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                    {r.claimed_by ? (
                      <span className="inline-flex items-center gap-1.5">
                        <AgentAvatar size="xs" name={r.claimed_by_name} path={r.claimed_by_avatar_url} />
                        <span className="max-w-[8rem] truncate">{r.claimed_by_name ?? "Claimed"}</span>
                      </span>
                    ) : (
                      <span className="text-cyan-400/70">Open</span>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    onClick={(e) => { e.stopPropagation(); removeRecent(key); }}
                    className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {open && enabled && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[60vh] overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
          {resultsQ.isLoading ? (
            <div className="p-3 text-xs text-muted-foreground">Searching…</div>
          ) : resultsQ.error ? (
            <div className="p-3 text-xs text-destructive">{(resultsQ.error as Error).message}</div>
          ) : rows.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">No leads match "{debounced}".</div>
          ) : (
            <ul className="divide-y divide-border/50">
              {rows.map((r) => (
                <li
                  key={`${r.source}-${r.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => go(r)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(r); } }}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        {((r.first_name ?? "") + " " + (r.last_name ?? "")).trim() || "—"}
                      </span>
                      {r.source === "live" ? (
                        <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/40 px-1.5 py-0 text-[10px] uppercase">Live</Badge>
                      ) : (
                        <Badge variant="outline" className="border-cyan-500/40 text-cyan-300 px-1.5 py-0 text-[10px] uppercase">{r.list_type || "List"}</Badge>
                      )}
                      {r.dispo && (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] uppercase">{r.dispo}</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {r.phone ?? "—"}
                      {" · "}
                      {[r.city, r.state, r.zip].filter(Boolean).join(", ") || "—"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                    {r.claimed_by ? (
                      <span className="inline-flex items-center gap-1.5">
                        <AgentAvatar size="xs" name={r.claimed_by_name} path={r.claimed_by_avatar_url} />
                        <span className="max-w-[8rem] truncate">{r.claimed_by_name ?? "Claimed"}</span>
                      </span>
                    ) : (
                      <span className="text-cyan-400/70">Open</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}