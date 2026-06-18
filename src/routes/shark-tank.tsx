import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useHasRole } from "@/lib/auth";
import { AppShell, PageHeader, HeroTitle, SwooshIcon } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getLeadBillability } from "@/lib/billing.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Sheet as Dialog,
  SheetContent as DialogContent,
  SheetDescription as DialogDescription,
  SheetFooter as DialogFooter,
  SheetHeader as DialogHeader,
  SheetTitle as DialogTitle,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DISPO_OPTIONS, type Dispo, SCRIPT_TYPES, type ScriptType } from "@/lib/constants";
import { VEHICLE_YEARS, VEHICLE_MAKES, VEHICLE_MODELS_BY_MAKE, type Vehicle } from "@/lib/constants";
import { LeadSideDispoPanel, type SideState, type HousingStatus } from "@/components/LeadSideDispo";
import { LeadExtraLines } from "@/components/LeadExtraLines";
import { canCloseLead } from "@/lib/closeGuard";
import { listSalesAgents, lookupVendorNames, lookupProfileNames, claimFirstAdmin } from "@/lib/admin.functions";
import { backfillZillowForListLeads } from "@/lib/zillow.functions";
import { Shield, Plus, Pencil, Lock, Activity, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { LeadActivityList } from "@/components/LeadActivityList";
import { LeadShareSection } from "@/components/LeadShareSection";
import { BulkActionBar } from "@/components/BulkActionBar";
import { Checkbox } from "@/components/ui/checkbox";
import { Phone, Mail } from "lucide-react";
import { CallButton } from "@/components/CallButton";
import { EmailLeadButton } from "@/components/EmailLeadButton";
import { LeadScoreChip } from "@/components/LeadScoreChip";
import { AgentAvatar } from "@/components/AgentAvatar";
import { LeadNotesThread } from "@/components/LeadNotesThread";
import { EditLeadDialog as LeadWorkspaceDialog } from "@/routes/liveleads";

export const Route = createFileRoute("/shark-tank")({
  head: () => ({
    meta: [
      { title: "Shark Tank — LeadVault" },
      { name: "description", content: "Leads imported from uploaded lists." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    lead: typeof s.lead === "string" ? s.lead : undefined,
    q: typeof s.q === "string" ? s.q : undefined,
    side: s.side === "home" ? "home" as const : "auto" as const,
  }),
  component: ListLeadsPage,
});

type Lead = {
  id: string;
  vendor_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  date_of_birth: string | null;
  street: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  current_carrier: string;
  num_vehicles: number;
  vendor_notes: string | null;
  vehicles: Vehicle[];
  list_type: string | null;
  dispo: Dispo | null;
  quoted_premium: number | null;
  current_premium: number | null;
  vendor_payout: number | null;
  agent_id: string | null;
  agent_notes: string | null;
  optin_proof_path: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  follow_up_at: string | null;
  x_date: string | null;
  created_at: string;
  litigator?: boolean;
  not_billable?: boolean;
  billable_override?: boolean | null;
  archived_at?: string | null;
  housing_status?: "homeowner" | "renter" | null;
  auto_policies_count?: number | null;
  home_policies_count?: number | null;
  home_dispo?: Dispo | null;
  home_claimed_by?: string | null;
  home_quoted_premium?: number | null;
  home_follow_up_at?: string | null;
  home_x_date?: string | null;
  home_agent_notes?: string | null;
  lead_types?: string[] | null;
  composite_score?: number | null;
  score_tier?: "S" | "A" | "B" | "C" | null;
  auto_score?: number | null;
  home_score?: number | null;
  year_built?: number | null;
  square_feet?: number | null;
  dwelling_value?: number | null;
  roof_year?: number | null;
  roof_type?: string | null;
  construction_type?: string | null;
  flood_zone?: string | null;
  has_pool?: boolean | null;
  has_trampoline?: boolean | null;
  // Discriminator used when a search query is active and we merge
  // matches from the live `leads` table alongside `list_leads`.
  _source?: "list" | "live";
};


function ListLeadsPage() {
  const { user, roles, loading } = useAuth();
  const navigate = useNavigate();
  const isSales = useHasRole("sales", "admin");
  const isVendor = useHasRole("vendor");
  const isAdmin = useHasRole("admin");
  const isPending = roles.length === 1 && roles[0] === "pending";

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!loading && isVendor) navigate({ to: "/liveleads", replace: true });
  }, [loading, isVendor, navigate]);

  // Broadcast presence so the team availability strip can show "In the tank".
  useEffect(() => {
    if (!user?.id || isVendor) return;
    const ch = supabase.channel("shark-tank-room", {
      config: { presence: { key: user.id } },
    });
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void ch.track({ user_id: user.id, at: new Date().toISOString() });
      }
    });
    return () => {
      void ch.untrack();
      void supabase.removeChannel(ch);
    };
  }, [user?.id, isVendor]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Shield className="h-8 w-8 animate-pulse text-primary" />
      </div>
    );
  }

  return (
    <AppShell>
      {isPending ? <PendingState /> : <LeadsView isSales={isSales} isVendor={isVendor} isAdmin={isAdmin} />}
    </AppShell>
  );
}

function PendingState() {
  return (
    <Card className="mx-auto max-w-2xl">
      <CardContent className="space-y-4 pt-6">
        <h2 className="text-lg font-semibold">Awaiting approval</h2>
        <p className="text-sm text-muted-foreground">
          Your account has been created. An admin needs to assign you a role (Vendor or Sales Agent) before you can use LeadVault.
        </p>
      </CardContent>
    </Card>
  );
}

function EnrichZillowButton() {
  const run = useServerFn(backfillZillowForListLeads);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const tId = toast.loading("Enriching leads with Zillow…");
        let totalSucceeded = 0;
        let totalFailed = 0;
        try {
          // Loop a few batches so admins see meaningful progress in one click.
          for (let i = 0; i < 4; i++) {
            const r = await run({ data: { limit: 25 } });
            totalSucceeded += r.succeeded;
            totalFailed += r.failed;
            toast.loading(
              `Enriching… ${totalSucceeded} added, ${totalFailed} failed, ${r.remaining.toLocaleString()} remaining`,
              { id: tId },
            );
            if (r.processed === 0) break;
          }
          toast.success(`Done: ${totalSucceeded} enriched, ${totalFailed} failed`, { id: tId });
          qc.invalidateQueries({ queryKey: ["list_leads"] });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Enrichment failed", { id: tId });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Enriching…" : "Enrich Zillow"}
    </Button>
  );
}



function LeadsView({ isSales, isVendor, isAdmin }: { isSales: boolean; isVendor: boolean; isAdmin: boolean }) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Lead | null>(null);
  const [viewing, setViewing] = useState<Lead | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { user } = useAuth();
  const qc = useQueryClient();
  const currentUserId = user?.id ?? "";
  const navigate = useNavigate();
  const { lead: deepLinkLead, q: urlQ, side } = Route.useSearch();
  const setSide = (next: "auto" | "home") => {
    navigate({
      to: "/shark-tank",
      search: (prev: Record<string, unknown>) => ({ ...prev, side: next === "auto" ? undefined : next }),
      replace: true,
    });
  };

  // Sync the global header search (?q=) into the local filter so typing
  // anywhere lands you here with the tank filtered in place.
  useEffect(() => {
    setSearch(urlQ ?? "");
  }, [urlQ]);

  const lookupVendors = useServerFn(lookupVendorNames);
  const fetchAgents = useServerFn(listSalesAgents);
  const lookupProfiles = useServerFn(lookupProfileNames);

  const leadsQ = useQuery({
    queryKey: [
      "list_leads", page, search, currentUserId, isSales, side,
    ],
    queryFn: async () => {
      const q = search.trim();
      const from = page * PAGE_SIZE;
      // Fetch one extra row to detect whether another page exists,
      // so we can skip the very expensive `count(*)` query against a
      // 50k+ row table.
      const to = from + PAGE_SIZE; // inclusive => PAGE_SIZE + 1 rows

      // Fuzzy (typo / nickname) suggestions: when the query contains a
      // name-like token (2+ letters), ask Postgres for ids of leads whose
      // first/last name is trigram-similar. We merge these ids into the
      // main filter via `id.in.(...)` so e.g. "Jon Smyth" can still surface
      // "John Smith" alongside any exact ilike hits.
      let fuzzyIds: string[] = [];
      const hasLetters = /[a-zA-Z]{2,}/.test(q);
      if (hasLetters) {
        const { data: fuzzy } = await supabase.rpc("fuzzy_list_lead_ids", {
          q,
          lim: 50,
        });
        fuzzyIds = ((fuzzy as Array<{ id: string }> | null) ?? []).map((r) => r.id);
      }

      // Same trigram fallback against the live `leads` table so the
      // global search can surface live leads (e.g. an active follow-up)
      // even when their name is misspelled.
      let liveFuzzyIds: string[] = [];
      if (q && hasLetters) {
        const { data: liveFuzzy } = await supabase.rpc("fuzzy_lead_ids", {
          q,
          lim: 50,
        });
        liveFuzzyIds = ((liveFuzzy as Array<{ id: string }> | null) ?? []).map((r) => r.id);
      }

      const applyFilters = <T extends ReturnType<typeof supabase.from>>(qb: T): T => {
        let out = qb as any;
        out = out.is("archived_at", null);
        // Default tank view shows only the open pool. When the global
        // search is active we drop these filters so any matching lead —
        // claimed, dispo'd, or otherwise — surfaces in place.
        if (!q) {
          if (side === "home") {
            out = out
              .or("housing_status.is.null,housing_status.neq.renter")
              .or("shark_tank_side.eq.home,shark_tank_side.is.null")
              .is("claimed_by", null)
              .is("agent_id", null)
              .is("home_claimed_by", null)
              .is("dispo", null)
              .is("home_dispo", null);
          } else {
            out = out
              .or("shark_tank_side.eq.auto,shark_tank_side.is.null")
              .is("claimed_by", null)
              .is("agent_id", null)
              .is("home_claimed_by", null)
              .is("dispo", null)
              .is("home_dispo", null);
          }
        }
        if (q) {
          const safe = q.replace(/[%(),"']/g, " ").trim();
          if (safe) {
            const words = safe.split(/\s+/).filter(Boolean);
            const parts: string[] = [
              `first_name.ilike.%${safe}%`,
              `last_name.ilike.%${safe}%`,
              `phone.ilike.%${safe}%`,
              `city.ilike.%${safe}%`,
              `state.ilike.%${safe}%`,
              `zip.ilike.%${safe}%`,
              `current_carrier.ilike.%${safe}%`,
            ];
            // Multi-word names: "joe w" should match first_name=joe + last_name=w*
            if (words.length >= 2) {
              const w1 = words[0];
              const w2 = words[1];
              parts.push(
                `and(first_name.ilike.%${w1}%,last_name.ilike.%${w2}%)`,
                `and(first_name.ilike.%${w2}%,last_name.ilike.%${w1}%)`,
              );
              // Fuzzy fallback: if only one of the two name parts matches
              // (e.g. correct last name but wrong first name, or vice versa),
              // still surface the lead as a suggestion. Skip very short tokens
              // to avoid flooding results with single-letter matches.
              for (const w of words) {
                if (w.length >= 2) {
                  parts.push(
                    `first_name.ilike.%${w}%`,
                    `last_name.ilike.%${w}%`,
                  );
                }
              }
            }
            // Format-tolerant phone search: phones are stored "(305) 401-5824",
            // so a query of "3054015824" or "305-401-5824" wouldn't match the
            // raw ilike above. Strip the query to digits and interleave with
            // % so the separators in the stored value don't break the match.
            const digits = q.replace(/\D/g, "");
            if (digits.length >= 4) {
              parts.push(`phone.ilike.%${digits.split("").join("%")}%`);
            }
            if (fuzzyIds.length > 0) {
              parts.push(`id.in.(${fuzzyIds.join(",")})`);
            }
            out = out.or(parts.join(","));
          }
        }
        return out as T;
      };

      const dataQ = applyFilters(
        supabase
          .from("list_leads")
          .select("agent_id,agent_notes,archived_at,auto_motor_club_premium,auto_policies_count,auto_sale_type,auto_score,billable_override,city,claimed_at,claimed_by,claims_last_5y,composite_score,construction_type,county,created_at,current_carrier,current_home_carrier,current_premium,date_of_birth,dispo,dwelling_value,email,first_name,follow_up_at,has_pool,has_trampoline,home_agent_notes,home_claimed_at,home_claimed_by,home_dispo,home_follow_up_at,home_policies_count,home_quoted_premium,home_sale_type,home_score,home_x_date,housing_status,id,import_batch_id,last_name,lead_source,lead_type,lead_types,list_type,list_type_priority,litigator,mortgage_company,not_billable,num_bathrooms,num_bedrooms,num_stories,num_vehicles,phone,quoted_premium,referred_by,roof_type,roof_year,score_breakdown,score_tier,scored_at,source_row,square_feet,state,street,transferred_at,transferred_by,transferred_lead_id,updated_at,vehicles,vendor_id,vendor_notes,x_date,year_built,zip") as any,
      );
      // When a search is active we want relevance ordering, not the default
      // composite-score sort. We pull a wider window of matches and rank
      // them client-side below. When idle, fall back to the score-based
      // ordering that powers the open-pool browse view.
      if (!q) {
        if (side === "home") {
          dataQ
            .order("home_score", { ascending: false, nullsFirst: false })
            .order("dwelling_value", { ascending: false, nullsFirst: false })
            .order("year_built", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false });
        } else {
          dataQ
            .order("composite_score", { ascending: false, nullsFirst: false })
            .order("num_vehicles", { ascending: false, nullsFirst: false })
            .order("score_tier", { ascending: true, nullsFirst: false })
            .order("list_type_priority", { ascending: true })
            .order("claimed_by", { ascending: true, nullsFirst: true })
            .order("agent_id", { ascending: true, nullsFirst: true })
            .order("created_at", { ascending: false });
        }
      }

      const countQ = applyFilters(
        supabase.from("list_leads").select("*", { count: "exact", head: true }) as any
      );

      // For relevance ranking we need to see all the matches up-front rather
      // than just one DB page, so widen the fetch when searching. 500 is
      // plenty for any sensible name/phone query against the open pool.
      const SEARCH_FETCH_CAP = 500;
      const fetchRange: [number, number] = q
        ? [0, SEARCH_FETCH_CAP - 1]
        : [from, to];

      const [{ data, error }, { count: totalCount, error: countError }] = await Promise.all([
        dataQ.range(fetchRange[0], fetchRange[1]),
        countQ,
      ]);

      if (error) throw error;
      if (countError) throw countError;

      let rowsRaw = (data as unknown as Lead[]) ?? [];
      // Tag list-lead rows so the row renderer can distinguish them
      // from any live-lead matches we merge in below.
      rowsRaw = rowsRaw.map((r) => ({ ...r, _source: "list" as const }));

      // When a search is active, also query the live `leads` table so
      // claimed/working leads (which never appear in the open-pool list)
      // surface in the global header search.
      if (q) {
        const safe = q.replace(/[%(),"']/g, " ").trim();
        if (safe) {
          const words = safe.split(/\s+/).filter(Boolean);
          const parts: string[] = [
            `first_name.ilike.%${safe}%`,
            `last_name.ilike.%${safe}%`,
            `phone.ilike.%${safe}%`,
            `city.ilike.%${safe}%`,
            `state.ilike.%${safe}%`,
            `zip.ilike.%${safe}%`,
            `current_carrier.ilike.%${safe}%`,
          ];
          if (words.length >= 2) {
            const [w1, w2] = words;
            parts.push(
              `and(first_name.ilike.%${w1}%,last_name.ilike.%${w2}%)`,
              `and(first_name.ilike.%${w2}%,last_name.ilike.%${w1}%)`,
            );
            for (const w of words) {
              if (w.length >= 2) {
                parts.push(
                  `first_name.ilike.%${w}%`,
                  `last_name.ilike.%${w}%`,
                );
              }
            }
          }
          const digits = q.replace(/\D/g, "");
          if (digits.length >= 4) {
            parts.push(`phone.ilike.%${digits.split("").join("%")}%`);
          }
          if (liveFuzzyIds.length > 0) {
            parts.push(`id.in.(${liveFuzzyIds.join(",")})`);
          }
          const { data: liveData, error: liveErr } = await (supabase
            .from("leads")
            .select("*") as any)
            .is("archived_at", null)
            .or(parts.join(","))
            .limit(100);
          if (!liveErr && Array.isArray(liveData)) {
            const liveRows = (liveData as any[]).map((r) => ({
              ...r,
              // Fields that exist on list_leads but not on the live
              // `leads` table — keep them null so the row renderer
              // (which expects these on the Lead type) doesn't crash.
              list_type: null,
              _source: "live" as const,
            })) as Lead[];
            rowsRaw = [...rowsRaw, ...liveRows];
          }
        }
      }

      if (q) {
        // Score each row by how well it matches the query. Higher is better.
        // Signals (weighted): exact full-name match, prefix matches on
        // first/last, substring matches, phone digits match, trigram rank
        // from the fuzzy RPC.
        const qLower = q.toLowerCase().trim();
        const words = qLower.split(/\s+/).filter(Boolean);
        const qDigits = q.replace(/\D/g, "");
        const fuzzyRank = new Map<string, number>();
        fuzzyIds.forEach((id, idx) => fuzzyRank.set(id, idx));

        const scoreRow = (r: Lead): number => {
          const fn = (r.first_name ?? "").toLowerCase();
          const ln = (r.last_name ?? "").toLowerCase();
          const full = `${fn} ${ln}`.trim();
          const phone = (r.phone ?? "").replace(/\D/g, "");
          let s = 0;
          // Ranking tiers (highest wins). Bands are spaced so a higher tier
          // always beats any combination of lower tiers:
          //   phone exact         100000
          //   phone partial        50000
          //   full two-word name   20000   (must beat fuzzy stacking)
          //   last-name exact      10000   (last name > first name)
          //   first-name exact      6000
          //   last-name prefix      4000
          //   first-name prefix     2400
          //   last-name contains    1500
          //   first-name contains    900
          //   fuzzy / trigram       0..500

          // Phone exact / contains.
          if (qDigits.length >= 7) {
            if (phone === qDigits) s += 100000;
            else if (phone.includes(qDigits)) s += 50000;
          }
          // Full two-word name match (both tokens land on the right field).
          if (words.length >= 2) {
            const [a, b] = words;
            if ((fn === a && ln === b) || (fn === b && ln === a)) {
              s += 20000;
            } else if (
              (fn.includes(a) && ln.includes(b)) ||
              (fn.includes(b) && ln.includes(a))
            ) {
              s += 15000;
            }
          }
          // Full-name exact (single-token "firstlast" or pre-joined).
          if (full && full === qLower) s += 18000;
          // Per-word matches — last name always beats first name at the
          // same match strength.
          for (const w of words) {
            if (!w) continue;
            if (ln === w) s += 10000;
            else if (ln.startsWith(w)) s += 4000;
            else if (ln.includes(w)) s += 1500;
            if (fn === w) s += 6000;
            else if (fn.startsWith(w)) s += 2400;
            else if (fn.includes(w)) s += 900;
          }
          // Trigram similarity rank from the RPC (lower idx = closer).
          const fr = fuzzyRank.get(r.id);
          if (fr !== undefined) s += Math.max(0, 500 - fr * 10);
          return s;
        };

        rowsRaw = [...rowsRaw].sort((a, b) => {
          const diff = scoreRow(b) - scoreRow(a);
          if (diff !== 0) return diff;
          // Tiebreak: prefer unclaimed/open leads, then composite score.
          const aOpen = !a.claimed_by && !a.agent_id ? 1 : 0;
          const bOpen = !b.claimed_by && !b.agent_id ? 1 : 0;
          if (aOpen !== bOpen) return bOpen - aOpen;
          return (b.composite_score ?? 0) - (a.composite_score ?? 0);
        });
      }

      const pageStart = q ? from : 0;
      const pageEnd = q ? from + PAGE_SIZE : PAGE_SIZE;
      const paged = q ? rowsRaw.slice(pageStart, pageEnd) : rowsRaw.slice(0, PAGE_SIZE);
      const hasMore = q ? rowsRaw.length > from + PAGE_SIZE : rowsRaw.length > PAGE_SIZE;
      const rows = paged;
      return {
        rows,
        hasMore,
        totalCount: totalCount ?? 0,
      };
    },
  });

  const vendorIds = useMemo(() => Array.from(new Set((leadsQ.data?.rows ?? []).map((l) => l.vendor_id).filter((x): x is string => !!x))), [leadsQ.data?.rows]);

  // Deep-link from elsewhere: seed the local search filter with the
  // lead's name so they appear in-place at the top of the tank, then
  // clear the URL param. Typing/clearing the search box behaves normally.
  useEffect(() => {
    if (!deepLinkLead) return;
    const inPage = (leadsQ.data?.rows ?? []).find((l) => l.id === deepLinkLead);
    const seed = (lead: Lead) => {
      const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
      setSearch(name || lead.phone || "");
      navigate({ to: "/shark-tank", search: {}, replace: true });
    };
    if (inPage) { seed(inPage); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("list_leads")
        .select("first_name,last_name,phone")
        .eq("id", deepLinkLead)
        .maybeSingle();
      if (cancelled || !data) return;
      seed(data as unknown as Lead);
    })();
    return () => { cancelled = true; };
  }, [deepLinkLead, leadsQ.data?.rows, navigate]);

  const vendorsQ = useQuery({
    queryKey: ["vendor-names", vendorIds],
    queryFn: () => lookupVendors({ data: { vendor_ids: vendorIds } }),
    enabled: isSales && vendorIds.length > 0,
  });

  const agentsQ = useQuery({
    queryKey: ["sales-agents"],
    queryFn: () => fetchAgents(),
    enabled: isSales,
  });

  const vendorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of vendorsQ.data ?? []) m.set(v.id, v.company_name || v.full_name || v.email);
    return m;
  }, [vendorsQ.data]);

  const vendorRulesMap = useMemo(() => {
    const m = new Map<string, { min_vehicles: number | null; max_age: number | null }>();
    for (const v of vendorsQ.data ?? []) {
      const vv = v as { id: string; min_vehicles?: number | null; max_age?: number | null };
      m.set(vv.id, { min_vehicles: vv.min_vehicles ?? null, max_age: vv.max_age ?? null });
    }
    return m;
  }, [vendorsQ.data]);

  // For vendor users, look up their own profile so we can apply
  // vendor-specific billability rules (e.g. min vehicle count).
  const ownProfileQ = useQuery({
    queryKey: ["own-profile", currentUserId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, company_name, full_name, email, min_vehicles, max_age")
        .eq("id", currentUserId)
        .single();
      if (error) throw error;
      return data as {
        id: string;
        company_name: string | null;
        full_name: string | null;
        email: string;
        min_vehicles: number | null;
        max_age: number | null;
      };
    },
    enabled: isVendor && !isSales && !!currentUserId,
  });

  const resolveVendorName = (vendorId: string): string | undefined => {
    const fromMap = vendorMap.get(vendorId);
    if (fromMap) return fromMap;
    if (vendorId === currentUserId && ownProfileQ.data) {
      const p = ownProfileQ.data;
      return p.company_name || p.full_name || p.email;
    }
    return undefined;
  };

  const resolveVendorRules = (vendorId: string): VendorRules => {
    const fromMap = vendorRulesMap.get(vendorId);
    if (fromMap) return fromMap;
    if (vendorId === currentUserId && ownProfileQ.data) {
      return {
        min_vehicles: ownProfileQ.data.min_vehicles ?? null,
        max_age: ownProfileQ.data.max_age ?? null,
      };
    }
    return { min_vehicles: null, max_age: null };
  };

  const agentMap = useMemo(() => {
    const m = new Map<string, { name: string; avatar_url: string | null }>();
    for (const a of agentsQ.data ?? [])
      m.set(a.id, {
        name: a.full_name || a.email,
        avatar_url: (a as { avatar_url?: string | null }).avatar_url ?? null,
      });
    return m;
  }, [agentsQ.data]);

  // Resolve any agent_id / claimed_by present on visible rows that aren't in
  // the sales-agents list (e.g. admins who claimed/quoted a lead).
  const missingProfileIds = useMemo(() => {
    const ids = new Set<string>();
    for (const l of leadsQ.data?.rows ?? []) {
      if (l.agent_id && !agentMap.has(l.agent_id)) ids.add(l.agent_id);
      if (l.claimed_by && !agentMap.has(l.claimed_by)) ids.add(l.claimed_by);
    }
    return Array.from(ids);
  }, [leadsQ.data?.rows, agentMap]);

  const extraProfilesQ = useQuery({
    queryKey: ["list-leads-extra-profiles", missingProfileIds],
    queryFn: () => lookupProfiles({ data: { user_ids: missingProfileIds } }),
    enabled: isSales && missingProfileIds.length > 0,
  });

  const resolveAgentName = (id: string | null | undefined): string => {
    if (!id) return "—";
    const fromAgents = agentMap.get(id);
    if (fromAgents) return fromAgents.name;
    const extra = (extraProfilesQ.data ?? []).find((p) => p.id === id);
    if (extra) return extra.full_name || extra.email;
    return "—";
  };

  const resolveAgentAvatar = (id: string | null | undefined): string | null => {
    if (!id) return null;
    const fromAgents = agentMap.get(id);
    if (fromAgents) return fromAgents.avatar_url;
    const extra = (extraProfilesQ.data ?? []).find((p) => p.id === id) as
      | { avatar_url?: string | null }
      | undefined;
    return extra?.avatar_url ?? null;
  };

  useEffect(() => {
    setPage(0);
  }, [search, side]);

  const hasMore = leadsQ.data?.hasMore ?? false;
  const currentPage = page;
  const paged = leadsQ.data?.rows ?? [];

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const allSelected = paged.length > 0 && paged.every((r) => prev.has(r.id));
      if (allSelected) return new Set();
      return new Set(paged.map((r) => r.id));
    });
  };

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            <span className="relative inline-flex">
              <span className="absolute inset-0 rounded-full bg-cyan-400/30 blur-md animate-pulse" />
              <SwooshIcon className="relative h-6 w-6 text-cyan-400 md:h-7 md:w-7" />
            </span>
            <span className="text-xl font-extrabold uppercase tracking-tight md:text-2xl">
              <span className="text-foreground">SHARK </span>
              <span className="text-cyan-400">TANK</span>
            </span>
            <span
              className="inline-flex overflow-hidden rounded-md border border-cyan-500/40 bg-background/60 text-[10px] font-bold uppercase tracking-widest"
              role="tablist"
              aria-label="Lead side"
            >
              <button
                type="button"
                role="tab"
                aria-selected={side === "auto"}
                onClick={(e) => { e.stopPropagation(); setSide("auto"); }}
                className={`px-2.5 py-1 transition-colors ${
                  side === "auto"
                    ? "bg-cyan-500 text-black"
                    : "text-cyan-300/80 hover:bg-cyan-500/10"
                }`}
              >
                Auto
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={side === "home"}
                onClick={(e) => { e.stopPropagation(); setSide("home"); }}
                className={`px-2.5 py-1 transition-colors ${
                  side === "home"
                    ? "bg-cyan-500 text-black"
                    : "text-cyan-300/80 hover:bg-cyan-500/10"
                }`}
              >
                Home
              </button>
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-cyan-400 animate-pulse">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.9)]" />
              Live Feed
            </span>
          </span>
        }
        action={
          <div className="flex items-center gap-2">
            {isAdmin && side === "home" && <EnrichZillowButton />}
            <div className="hidden md:inline-flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.7)]" />
              <span className="tabular-nums text-foreground">{leadsQ.data?.totalCount?.toLocaleString() ?? "—"}</span>
              <span>leads in tank</span>
            </div>
            <Button asChild size="sm" className="gap-2 bg-cyan-500 text-black hover:bg-cyan-400 font-bold">
              <Link to="/leads/new" search={{ as: "shark" }}><Plus className="h-4 w-4" /> Add lead</Link>
            </Button>
          </div>
        }
      />

      <Card className="overflow-hidden rounded-2xl border-cyan-500/30 shadow-[0_0_60px_-10px_rgba(34,211,238,0.35)] bg-background/40">
          <CardContent className="p-0">
            {leadsQ.isLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading leads…</div>
            ) : paged.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                No leads yet.
                {isAdmin && (
                  <>
                    {" "}
                    <Link
                      to="/leads/new"
                      search={{ as: "shark" }}
                      className="font-medium text-accent underline-offset-4 hover:underline"
                    >
                      Add or import your first lead
                    </Link>
                    .
                  </>
                )}
              </div>
            ) : (
              <>
              {/* Mobile cards */}
              <ul className="md:hidden divide-y">
                {paged.map((l) => {
                  const mine = (!!l.claimed_by && l.claimed_by === currentUserId) || (!!l.agent_id && l.agent_id === currentUserId);
                  const claimed = !!l.claimed_by || !!l.agent_id;
                  const canOpen = true;
                  const accent = mine
                    ? "border-l-4 border-l-amber-500 bg-amber-50/60"
                    : claimed
                    ? "border-l-4 border-l-amber-400 bg-amber-50/30"
                    : "border-l-4 border-l-emerald-400 bg-emerald-50/30";
                  return (
                    <li
                      key={l.id}
                      className={`${accent} p-4 ${canOpen ? "cursor-pointer active:bg-muted/40" : "opacity-80"}`}
                      onClick={() => {
                        if (l._source === "live") {
                          navigate({ to: "/leads/$leadId", params: { leadId: l.id } });
                          return;
                        }
                        if (isSales) setEditing(l);
                        else setViewing(l);
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold truncate text-base">{l.first_name} {l.last_name}</span>
                            <LeadScoreChip score={side === "home" ? (l.home_score ?? null) : l.composite_score} tier={l.score_tier} size="xs" showTier={false} />
                            {claimed && !mine && isSales && !isAdmin && <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {l.list_type && (
                              <Badge variant="outline" className="px-1.5 py-0 text-[10px] uppercase">{formatListType(l.list_type)}</Badge>
                            )}
                            {Array.isArray(l.lead_types) && l.lead_types.map((t: string) => (
                              <Badge key={t} variant="secondary" className="px-1.5 py-0 text-[10px] capitalize">{t}</Badge>
                            ))}
                          </div>
                      <div className="mt-1 text-sm text-muted-foreground truncate">
                        {l.city}, {l.state} {l.zip} · <span className="text-cyan-300">{l.current_carrier || "—"}</span>
                        {side === "home" ? (
                          <> · {l.year_built ?? "—"} built{l.dwelling_value ? ` · $${Math.round(Number(l.dwelling_value)/1000)}k` : ""}</>
                        ) : (
                          <> · {l.num_vehicles} veh</>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {resolveVendorName(l.vendor_id) ?? "—"} · {new Date(l.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          {l.litigator && <Badge variant="destructive" className="uppercase text-[10px]">Litigator</Badge>}
                        </div>
                      </div>
                      <div className="mt-2 inline-flex w-fit flex-col items-stretch gap-1" onClick={(e) => e.stopPropagation()}>
                         {l.phone && currentUserId ? (
                           <CallButton
                             leadId={l.id}
                             leadTable={l._source === "live" ? "leads" : "list_leads"}
                             phone={l.phone}
                             uid={currentUserId}
                             dnc={l.dispo === "dnc"}
                              onOpenLead={isSales ? () => {
                                if (l._source === "live") navigate({ to: "/leads/$leadId", params: { leadId: l.id } });
                                else setEditing(l);
                              } : undefined}
                             scriptType={(l.list_type as ScriptType | null) ?? undefined}
                             className="text-cyan-300"
                           />
                         ) : <span className="text-sm text-muted-foreground">No phone</span>}
                        {l.email && (
                          <EmailLeadButton
                            email={l.email}
                            leadId={l.id}
                            leadTable={l._source === "live" ? "leads" : "list_leads"}
                            firstName={l.first_name}
                            lastName={l.last_name}
                            phone={l.phone}
                            carrier={l.current_carrier}
                            city={l.city}
                            state={l.state}
                            zip={l.zip}
                            quotedPremium={l.quoted_premium}
                            currentPremium={l.current_premium}
                            vehicles={l.vehicles}
                            vendorNotes={l.vendor_notes}
                            className="text-cyan-300"
                          />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="hidden md:block overflow-x-auto">
                <Table className="[&_tr]:border-white/5">
                  <TableHeader>
                    <TableRow className="border-b border-white/5 hover:bg-transparent">
                      {isSales && (
                        <TableHead className="w-8 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                          <Checkbox
                            checked={paged.length > 0 && paged.every((r) => selectedIds.has(r.id))}
                            onCheckedChange={toggleSelectAll}
                            aria-label="Select all"
                          />
                        </TableHead>
                      )}
                      {(["Type","Score","Name","Phone / Email","Location","Carrier", side === "home" ? "Home" : "Veh.","DOB","Agent","Received",""] as const).map((h, i) => {
                        if (h === "Type" && !isSales) return null;
                        if (h === "DOB" && !isSales) return null;
                        if (h === "Agent" && !isSales) return null;
                        const align = h === "Score" || h === "Veh." || h === "Home" ? "text-center" : "";
                        const center = h === "Phone / Email" || h === "Location" || h === "Carrier" || h === "Received" ? "text-center" : "";
                        const w = h === "" ? "w-12" : "";
                        return (
                          <TableHead key={i} className={`text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400/80 ${align} ${center} ${w}`}>
                            {h}
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged.map((l) => {
                      const mine = (!!l.claimed_by && l.claimed_by === currentUserId) || (!!l.agent_id && l.agent_id === currentUserId);
                      const claimed = !!l.claimed_by || !!l.agent_id;
                      const canOpen = true;
                      const lockedReadOnly = isSales && !isAdmin && claimed && !mine;
                      const hot = !claimed && (l.score_tier === "S" || l.score_tier === "A" || (l.composite_score ?? 0) >= 130);
                      const baseCls = "group cursor-pointer transition-all [&>td]:align-middle [&>td]:py-4";
                      const rowCls = mine
                        ? `${baseCls} bg-amber-500/5 hover:bg-amber-500/10`
                        : claimed
                        ? `${baseCls} opacity-60 hover:opacity-100 hover:bg-muted/30`
                        : hot
                        ? `${baseCls} hover:bg-cyan-500/[0.05]`
                        : `${baseCls} hover:bg-white/[0.02]`;
                      const fresh = Date.now() - new Date(l.created_at).getTime() < 30 * 60 * 1000;
                      const scoreColor = hot
                        ? "text-cyan-400 border-cyan-500/50 bg-cyan-500/10 shadow-[0_0_12px_rgba(34,211,238,0.25)]"
                        : "text-cyan-400 border-cyan-500/50 bg-cyan-500/10";
                      return (
                      <TableRow
                        key={l.id}
                        className={rowCls}
                        onClick={() => {
                          if (l._source === "live") {
                            navigate({ to: "/leads/$leadId", params: { leadId: l.id } });
                            return;
                          }
                          if (isSales) setEditing(l);
                          else setViewing(l);
                        }}
                      >
                        {isSales && (
                          <TableCell onClick={(e) => e.stopPropagation()} className="!py-4">
                            <Checkbox
                              checked={selectedIds.has(l.id)}
                              onCheckedChange={() => toggleSelect(l.id)}
                              aria-label="Select lead"
                            />
                          </TableCell>
                        )}
                        {isSales && (
                          <TableCell className="align-middle">
                            <div className="flex items-center gap-3 pl-2">
                              <div className={`h-12 w-[3px] rounded-full transition-all ${
                                hot ? "bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.9)]"
                                : mine ? "bg-amber-500"
                                : claimed ? "bg-muted"
                                : "bg-cyan-500/60 group-hover:bg-cyan-400"
                              }`} />
                              <div className="flex items-center gap-2">
                                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-500/5 text-cyan-400">
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </span>
                                <span className="text-xs font-bold uppercase tracking-wider text-foreground/90">{formatListType(l.list_type)}</span>
                              </div>
                            </div>
                          </TableCell>
                        )}
                        <TableCell className="text-center">
                          <div className="flex justify-center">
                            <div className={`flex h-12 w-12 items-center justify-center rounded-full border-2 font-mono text-base font-bold tabular-nums transition-all ${scoreColor}`}>
                              {(side === "home" ? l.home_score : l.composite_score) ?? "—"}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className={`text-sm font-bold uppercase tracking-tight ${claimed && !mine ? "text-muted-foreground" : "text-foreground"}`}>
                              {l.first_name} {l.last_name}
                              {l._source === "live" && (
                                <Badge variant="outline" className="ml-2 rounded-md border-emerald-500/50 bg-emerald-500/10 px-1.5 py-0 text-[9px] font-bold uppercase tracking-widest text-emerald-400 align-middle">Live</Badge>
                              )}
                            </span>
                            {l.litigator && (
                              <Badge variant="destructive" className="mt-1.5 w-fit rounded-md border border-red-500/60 bg-red-500/15 px-2 py-0.5 font-bold uppercase tracking-wider text-[10px] text-red-400 hover:bg-red-500/20">TCPA Litigator</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="mx-auto inline-flex w-fit flex-col items-stretch gap-1.5">
                            {l.phone && currentUserId ? (
                              <CallButton
                                leadId={l.id}
                                leadTable={l._source === "live" ? "leads" : "list_leads"}
                                phone={l.phone}
                                uid={currentUserId}
                                dnc={l.dispo === "dnc"}
                                onOpenLead={isSales ? () => {
                                  if (l._source === "live") navigate({ to: "/leads/$leadId", params: { leadId: l.id } });
                                  else setEditing(l);
                                } : undefined}
                                scriptType={(l.list_type as ScriptType | null) ?? undefined}
                                className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/[0.04] py-1 pl-1 pr-3 font-mono text-[12px] font-semibold tracking-wide text-cyan-300 hover:border-cyan-400/70 hover:bg-cyan-500/[0.08] hover:text-cyan-200 hover:shadow-[0_0_14px_rgba(34,211,238,0.25)]"
                              >
                                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-500/10">
                                  <Phone className="h-3 w-3 text-cyan-400" />
                                </span>
                                {l.phone}
                              </CallButton>
                            ) : null}
                            {l.email && (
                              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/[0.04] py-1 pl-1 pr-3 transition-all group-hover:border-cyan-400/70 group-hover:bg-cyan-500/[0.08] group-hover:shadow-[0_0_14px_rgba(34,211,238,0.25)]">
                                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-500/10">
                                  <Mail className="h-3 w-3 text-cyan-400" />
                                </span>
                                <EmailLeadButton
                                  email={l.email}
                                  leadId={l.id}
                                  leadTable={l._source === "live" ? "leads" : "list_leads"}
                                  firstName={l.first_name}
                                  lastName={l.last_name}
                                  phone={l.phone}
                                  carrier={l.current_carrier}
                                  city={l.city}
                                  state={l.state}
                                  zip={l.zip}
                                  quotedPremium={l.quoted_premium}
                                  currentPremium={l.current_premium}
                                  vehicles={l.vehicles}
                                  vendorNotes={l.vendor_notes}
                                  className="inline-flex items-center justify-start whitespace-nowrap rounded-md px-0 py-0 bg-transparent hover:bg-transparent text-cyan-300 hover:text-cyan-200 font-mono text-[12px] font-semibold tracking-wide"
                                />
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col leading-tight items-center text-center">
                            <span className="text-xs font-semibold uppercase tracking-wide text-foreground/90">
                              {l.city}, {l.state}
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground/60">{l.zip}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          {l.current_carrier ? (
                            <span className="inline-flex items-center rounded-md border border-cyan-500/40 bg-cyan-500/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                              {l.current_carrier}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {side === "home" ? (
                            <div className="flex flex-col items-center leading-tight">
                              <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                                {l.year_built ?? "—"}
                              </span>
                              <span className="text-[10px] text-muted-foreground/70 tabular-nums">
                                {l.dwelling_value ? `$${Math.round(Number(l.dwelling_value)/1000)}k` : "—"}
                                {l.square_feet ? ` · ${l.square_feet.toLocaleString()} sf` : ""}
                              </span>
                              {(l.roof_year || l.construction_type) && (
                                <span className="text-[10px] text-muted-foreground/60">
                                  {l.roof_year ? `roof ${l.roof_year}` : ""}
                                  {l.roof_year && l.construction_type ? " · " : ""}
                                  {l.construction_type ?? ""}
                                </span>
                              )}
                            </div>
                          ) : (
                            <>
                              <span className="font-mono text-lg font-bold tabular-nums text-foreground">
                                {l.num_vehicles}
                              </span>
                              <span className="ml-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">veh</span>
                            </>
                          )}
                        </TableCell>
                        {isSales && (
                          <TableCell className="whitespace-nowrap">
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">
                              {formatDob(l.date_of_birth)}
                            </span>
                          </TableCell>
                        )}
                        {isSales && (
                          <TableCell>
                            {l.agent_id ? (
                              <div className="flex items-center gap-2">
                                <AgentAvatar
                                  name={resolveAgentName(l.agent_id)}
                                  signedUrl={resolveAgentAvatar(l.agent_id)}
                                  size="xs"
                                />
                                <span className="text-xs font-medium text-muted-foreground truncate max-w-[100px]">
                                  {resolveAgentName(l.agent_id)}
                                </span>
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-cyan-400/70">
                                <span className="h-1 w-1 rounded-full bg-cyan-400" />
                                Unclaimed
                              </span>
                            )}
                          </TableCell>
                        )}
                        <TableCell className="whitespace-nowrap text-center">
                          <div className="flex items-center justify-center gap-2">
                            <span className={`h-1.5 w-1.5 rounded-full ${fresh ? "bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.9)]" : "bg-cyan-500/60"}`} />
                            <div className="flex flex-col items-start leading-tight">
                              <span className={`font-mono text-sm font-bold tabular-nums ${fresh ? "text-cyan-300" : "text-foreground"}`}>
                                {new Date(l.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}
                              </span>
                              <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/60">
                                {new Date(l.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase()}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={`flex h-7 w-7 items-center justify-center rounded-md border transition-all ${
                            lockedReadOnly
                              ? "border-border/40 text-muted-foreground/50"
                              : "border-cyan-500/20 text-cyan-400/70 group-hover:border-cyan-400 group-hover:text-cyan-300 group-hover:shadow-[0_0_10px_rgba(34,211,238,0.4)]"
                          }`}>
                            {lockedReadOnly ? (
                              <Lock className="h-3.5 w-3.5" />
                            ) : (
                              <Pencil className="h-3.5 w-3.5" />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              </>
            )}
            {(currentPage > 0 || hasMore) && (
              <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
                <span className="text-muted-foreground">
                  Showing {currentPage * PAGE_SIZE + 1}–
                  {currentPage * PAGE_SIZE + paged.length}
                  {hasMore ? "+" : ""} of {leadsQ.data?.totalCount?.toLocaleString() ?? "—"}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                  >
                    Previous
                  </Button>
                  <span className="text-muted-foreground">
                    Page {currentPage + 1}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!hasMore}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
          {paged.length > 0 && (
            <div className="flex items-center justify-between border-t border-cyan-500/10 bg-black/20 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <div className="flex items-center gap-4">
                <span className="inline-flex items-center gap-1.5">
                  <Activity className="h-3 w-3 text-cyan-400" />
                  Market Pulse
                </span>
                <span className="hidden sm:inline text-cyan-400/80">
                  {paged.filter((l) => Date.now() - new Date(l.created_at).getTime() < 30 * 60 * 1000).length} fresh
                </span>
                <span className="hidden md:inline text-emerald-400/80">
                  {paged.filter((l) => !l.claimed_by && !l.agent_id).length} open
                </span>
              </div>
              <span className="hidden sm:inline italic text-muted-foreground/70 normal-case tracking-normal">
                Fastest finger wins. Good luck, shark.
              </span>
            </div>
          )}
        </Card>

      {isSales && (
        <LeadWorkspaceDialog
          lead={
            editing
              ? ((leadsQ.data?.rows.find((r) => r.id === editing.id) ?? editing) as never)
              : null
          }
          onClose={() => setEditing(null)}
          agents={agentsQ.data ?? []}
          vendorName={editing ? resolveVendorName(editing.vendor_id) : undefined}
          vendorRules={editing ? resolveVendorRules(editing.vendor_id) : undefined}
          source="list_leads"
          preferredLob={side === "home" ? "home" : "auto"}
        />
      )}
      {isSales && (
        <BulkActionBar
          table="list_leads"
          selectedIds={Array.from(selectedIds)}
          onClear={() => setSelectedIds(new Set())}
          agents={agentsQ.data ?? []}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
        />
      )}
    </>
  );
}

function DispoBadge({ dispo }: { dispo: Dispo | null }) {
  return dispoBadgeImpl(dispo);
}

function formatListType(t: string | null): string {
  return formatListTypeImpl(t);
}

function formatRelativeShort(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.max(0, Math.floor(diffMs / 60000));
  if (m < 1) return "JUST IN";
  if (m < 60) return `${m}m AGO`;
  const h = Math.floor(m / 60);
  return `${h}h AGO`;
}

function formatListTypeImpl(t: string | null): string {
  if (!t) return "—";
  const map: Record<string, string> = {
    winback: "Winback",
    requote: "Requote",
    ivantage_no_allstate: "iVantage no Allstate",
    aged: "Aged",
    anchorline: "Anchorline",
    boat_no_home: "Boat no Home",
    auto_no_home: "Auto no Home",
  };
  return map[t] ?? t;
}

function dispoBadgeImpl(dispo: Dispo | null) {
  if (!dispo) return <span className="text-muted-foreground">—</span>;
  const label = DISPO_OPTIONS.find((d) => d.value === dispo)?.label ?? dispo;
  const cls: Record<Dispo, string> = {
    sold: "bg-emerald-100 text-emerald-900 border-emerald-200",
    quoted: "bg-sky-100 text-sky-900 border-sky-200",
    not_quoted: "bg-rose-100 text-rose-900 border-rose-200",
    voicemail: "bg-slate-100 text-slate-900 border-slate-200",
    follow_up: "bg-amber-100 text-amber-900 border-amber-200",
    x_date: "bg-violet-100 text-violet-900 border-violet-200",
    already_has_allstate: "bg-indigo-100 text-indigo-900 border-indigo-200",
    already_a_client: "bg-teal-100 text-teal-900 border-teal-200",
    wrong_number: "bg-slate-100 text-slate-900 border-slate-200",
    dead: "bg-zinc-200 text-zinc-900 border-zinc-300",
    dnc: "bg-red-100 text-red-900 border-red-300",
  };
  return <Badge variant="outline" className={cls[dispo]}>{label}</Badge>;
}

function FollowUpBadge({ at }: { at: string }) {
  const t = new Date(at).getTime();
  const overdue = t <= Date.now();
  const label = new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <span
      className={
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium " +
        (overdue
          ? "border-rose-200 bg-rose-100 text-rose-900"
          : "border-amber-200 bg-amber-50 text-amber-900")
      }
      title={overdue ? "Overdue follow-up" : "Scheduled follow-up"}
    >
      {overdue ? "Overdue " : "Due "} {label}
    </span>
  );
}

function EditLeadDialog({
  lead,
  onClose,
  agents,
  vendorName,
  vendorRules,
}: {
  lead: Lead | null;
  onClose: () => void;
  agents: Array<{ id: string; full_name: string | null; email: string }>;
  vendorName?: string;
  vendorRules?: VendorRules | null;
}) {
  const qc = useQueryClient();
  const isAdmin = useHasRole("admin");
  const { user } = useAuth();
  const currentUserId = user?.id ?? "";
  const claimedByOther = !!lead?.claimed_by && lead.claimed_by !== currentUserId;
  const lockedForMe = claimedByOther && !isAdmin;
  const claimedAgent = lead?.claimed_by
    ? agents.find((a) => a.id === lead.claimed_by)
    : null;
  const claimedLabel = claimedAgent ? (claimedAgent.full_name || claimedAgent.email) : "another agent";
  const [current, setCurrent] = useState("");
  const [agentId, setAgentId] = useState<string>("");
  const [dob, setDob] = useState("");
  const [vendorNotes, setVendorNotes] = useState("");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [stateVal, setStateVal] = useState("");
  const [zip, setZip] = useState("");
  const [county, setCounty] = useState("");
  const [carrier, setCarrier] = useState("");
  const [editVendor, setEditVendor] = useState(false);
  const [editingPhone, setEditingPhone] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);

  const guardedClose = async () => {
    if (!lead) return onClose();
    // Let any in-flight save finish so canCloseLead reads the post-save row.
    for (let i = 0; i < 10 && saveM.isPending; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const ok = await canCloseLead("list_leads", lead.id, currentUserId, isAdmin);
    if (ok) onClose();
  };

  useEffect(() => {
    if (lead) {
      setCurrent(lead.current_premium != null ? String(lead.current_premium) : "");
      setAgentId(lead.agent_id ?? "");
      setDob(lead.date_of_birth ?? "");
      setVendorNotes(lead.vendor_notes ?? "");
      setVehicles(Array.isArray(lead.vehicles) ? lead.vehicles : []);
      setFirstName(lead.first_name ?? "");
      setLastName(lead.last_name ?? "");
      setPhone(lead.phone ?? "");
      setEmail(lead.email ?? "");
      setStreet(lead.street ?? "");
      setCity(lead.city ?? "");
      setStateVal(lead.state ?? "");
      setZip(lead.zip ?? "");
      setCounty(lead.county ?? "");
      setCarrier(lead.current_carrier ?? "");
    }
  }, [lead]);

  const updateVehicle = (i: number, patch: Partial<Vehicle>) => {
    setVehicles((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  };
  const addVehicle = () => setVehicles((prev) => [...prev, { year: "", make: "", model: "" }]);
  const removeVehicle = (i: number) => setVehicles((prev) => prev.filter((_, idx) => idx !== i));

  const saveM = useMutation({
    mutationFn: async () => {
      if (!lead) return;
      const { error } = await supabase
        .from("list_leads")
        .update({
          current_premium: current ? Number(current) : null,
          agent_id: agentId || null,
          date_of_birth: dob || null,
          vendor_notes: vendorNotes || null,
          vehicles: vehicles as unknown as never,
          num_vehicles: vehicles.length,
          first_name: firstName,
          last_name: lastName,
          phone,
          email: email || null,
          street,
          city,
          state: stateVal,
          zip,
          county,
          current_carrier: carrier,
        })
        .eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lead updated");
      qc.invalidateQueries({ queryKey: ["list_leads"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  const deleteM = useMutation({
    mutationFn: async () => {
      if (!lead) return;
      const { error } = await supabase.from("list_leads").delete().eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lead deleted");
      qc.invalidateQueries({ queryKey: ["list_leads"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to delete"),
  });

  const fetchBillability = useServerFn(getLeadBillability);
  const billabilityQ = useQuery({
    queryKey: ["lead-billability", "list_leads", lead?.id],
    queryFn: () => fetchBillability({ data: { lead_id: lead!.id, source: "list_leads" } }),
    enabled: !!lead?.id,
    staleTime: 30_000,
  });
  const notBillable = billabilityQ.data && billabilityQ.data.billable === false;
  const notBillableReason = billabilityQ.data?.reasons?.[0] ?? "";

  return (
    <Dialog open={!!lead} onOpenChange={(o) => { if (!o) void guardedClose(); }}>
      <DialogContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto flex flex-col gap-4"
        onInteractOutside={(e) => {
          // Ignore interactions inside nested portalled dialogs/popovers so
          // closing them doesn't bubble up and dismiss the lead drawer.
          const target = e.target as HTMLElement | null;
          const insideOtherOverlay = !!target?.closest?.(
            '[role="dialog"],[role="alertdialog"],[data-radix-popper-content-wrapper],[data-radix-portal]'
          );
          if (insideOtherOverlay) {
            e.preventDefault();
            return;
          }
          e.preventDefault();
          void guardedClose();
        }}
        onEscapeKeyDown={(e) => { e.preventDefault(); void guardedClose(); }}
      >
        {lead && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {firstName} {lastName}
                <button
                  type="button"
                  onClick={() => setEditVendor((v) => !v)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Edit vendor info"
                  title={editVendor ? "Done editing" : "Edit vendor info"}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {notBillable && (
                  <Badge
                    title={notBillableReason}
                    className="rounded-full border-red-500/40 bg-red-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-red-300 hover:bg-red-500/20"
                  >
                    Not Billable
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription>
                {phone} · {street}, {city}, {stateVal} {zip} · {county} County
              </DialogDescription>
            </DialogHeader>

            {lead && currentUserId && (
              <div className="flex flex-wrap items-center gap-2">
                {editingPhone ? (
                  <div className="flex items-center gap-1">
                    <Input
                      autoFocus
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Phone"
                      className="h-10 w-48"
                    />
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditingPhone(false)}>Done</Button>
                  </div>
                ) : phone ? (
                  <CallButton
                    leadId={lead.id}
                    leadTable="list_leads"
                    phone={phone}
                    uid={currentUserId}
                    stopPropagation={false}
                    dnc={(lead.dispo as string | null) === "dnc"}
                    className="!inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 !text-sm font-semibold !text-primary-foreground shadow hover:bg-primary/90 hover:!no-underline w-fit"
                    scriptType={(lead.list_type as ScriptType | null) ?? undefined}
                    onBeforeCall={!lead.claimed_by ? async () => {
                      const { error } = await supabase
                        .from("list_leads")
                        .update({
                          claimed_by: currentUserId,
                          claimed_at: new Date().toISOString(),
                          agent_id: currentUserId,
                        })
                        .eq("id", lead.id);
                      if (error) { toast.error(error.message); return; }
                      qc.invalidateQueries({ queryKey: ["list_leads"] });
                    } : undefined}
                  >
                    <Phone className="h-4 w-4" /> Call {phone}
                  </CallButton>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingPhone(true)}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-dashed bg-background px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Add phone
                  </button>
                )}
                {!editingPhone && phone && (
                  <button
                    type="button"
                    onClick={() => setEditingPhone(true)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Edit phone"
                    aria-label="Edit phone"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}

                {editingEmail ? (
                  <div className="flex items-center gap-1">
                    <Input
                      autoFocus
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@example.com"
                      className="h-10 w-64"
                    />
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditingEmail(false)}>Done</Button>
                  </div>
                ) : email ? (
                  <EmailLeadButton
                  email={email}
                  leadId={lead.id}
                  leadTable="list_leads"
                  firstName={firstName}
                  lastName={lastName}
                  phone={phone}
                  carrier={carrier}
                  city={city}
                  state={stateVal}
                  zip={zip}
                  quotedPremium={lead.quoted_premium}
                  currentPremium={current ? Number(current) : lead.current_premium}
                  vehicles={vehicles}
                  vendorNotes={vendorNotes}
                  stopPropagation={false}
                  className="inline-flex items-center justify-center gap-2 rounded-md border bg-background px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
                >
                  Email
                </EmailLeadButton>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingEmail(true)}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-dashed bg-background px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Add email
                  </button>
                )}
                {!editingEmail && email && (
                  <button
                    type="button"
                    onClick={() => setEditingEmail(true)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Edit email"
                    aria-label="Edit email"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}

            {claimedByOther && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                Claimed by <strong>{claimedLabel}</strong>{isAdmin ? " (admin override)." : " — read-only for you."}
              </div>
            )}

            {!lead.claimed_by && lead.agent_id && lead.agent_id !== currentUserId && (() => {
              const a = agents.find((x) => x.id === lead.agent_id);
              const label = a ? (a.full_name || a.email) : "another agent";
              return (
                <div className="rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">
                  Assigned to <strong>{label}</strong>{isAdmin ? " (admin override)." : " — read-only for you until they claim or release it."}
                </div>
              );
            })()}

            {lead.claimed_by === currentUserId && currentUserId && (
              <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
                This lead is yours.
              </div>
            )}

            {!lead.claimed_by && currentUserId && (!lead.agent_id || lead.agent_id === currentUserId) && (
              <div className="flex items-center justify-between rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
                <span>
                  {lead.agent_id === currentUserId
                    ? "Assigned to you — claim it to lock it in."
                    : "Unclaimed lead — claim it to make it yours."}
                </span>
                <Button
                  size="sm"
                  onClick={async () => {
                    const { error } = await supabase
                      .from("list_leads")
                      .update({
                        claimed_by: currentUserId,
                        claimed_at: new Date().toISOString(),
                        agent_id: currentUserId,
                      })
                      .eq("id", lead.id);
                    if (error) { toast.error(error.message); return; }
                    toast.success("Lead claimed");
                    qc.invalidateQueries({ queryKey: ["list_leads"] });
                  }}
                >
                  Claim
                </Button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 rounded-md border bg-muted/30 p-4 text-sm">
              {editVendor ? (
                <>
                  <LabeledInput label="First name" value={firstName} onChange={setFirstName} />
                  <LabeledInput label="Last name" value={lastName} onChange={setLastName} />
                  <LabeledInput label="Current carrier" value={carrier} onChange={setCarrier} />
                  <div className="col-span-2 grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2">
                    <LabeledInput label="Street" value={street} onChange={setStreet} />
                    <LabeledInput label="City" value={city} onChange={setCity} />
                    <LabeledInput label="State" value={stateVal} onChange={setStateVal} />
                    <LabeledInput label="Zip" value={zip} onChange={setZip} />
                    <LabeledInput label="County" value={county} onChange={setCounty} />
                  </div>
                </>
              ) : (
                <>
                  <Field label="Current carrier" value={carrier} />
                  <Field label="Email" value={email || "—"} />
                </>
              )}
              <div className="space-y-2">
                <Label>Date of birth</Label>
                <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              </div>
              <div className="col-span-2 space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Vehicles ({vehicles.length})</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addVehicle}>
                    <Plus className="h-3 w-3 mr-1" /> Add vehicle
                  </Button>
                </div>
                <div className="space-y-2">
                  {vehicles.map((v, i) => {
                    const models = v.make ? VEHICLE_MODELS_BY_MAKE[v.make] ?? [] : [];
                    return (
                      <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end rounded border bg-background p-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Year</Label>
                          <Select value={v.year} onValueChange={(val) => updateVehicle(i, { year: val })}>
                            <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
                            <SelectContent className="max-h-72">
                              {VEHICLE_YEARS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Make</Label>
                          <Select value={v.make} onValueChange={(val) => updateVehicle(i, { make: val, model: "" })}>
                            <SelectTrigger><SelectValue placeholder="Make" /></SelectTrigger>
                            <SelectContent className="max-h-72">
                              {VEHICLE_MAKES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Model</Label>
                          <Select value={v.model} onValueChange={(val) => updateVehicle(i, { model: val })} disabled={!v.make}>
                            <SelectTrigger><SelectValue placeholder={v.make ? "Model" : "Select make"} /></SelectTrigger>
                            <SelectContent className="max-h-72">
                              {models.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button type="button" size="sm" variant="ghost" onClick={() => removeVehicle(i)}>Remove</Button>
                      </div>
                    );
                  })}
                  {vehicles.length === 0 && (
                    <p className="text-xs text-muted-foreground">No vehicles. Click "Add vehicle" to add one.</p>
                  )}
                </div>
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Vendor notes</Label>
                <Textarea rows={2} value={vendorNotes} onChange={(e) => setVendorNotes(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Agent</Label>
                <Select value={agentId} onValueChange={setAgentId}>
                  <SelectTrigger><SelectValue placeholder="Select agent…" /></SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.full_name || a.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Current premium ($) — what they pay today</Label>
                <Input type="number" step="0.01" value={current} onChange={(e) => setCurrent(e.target.value)} />
              </div>
            </div>

            <div className="rounded-md border p-4 space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Activity history
              </div>
              <LeadActivityList leadId={lead.id} leadTable="list_leads" />
            </div>

            <LeadShareSection
              leadId={lead.id}
              leadTable="list_leads"
              claimedBy={lead.claimed_by}
              uid={currentUserId}
            />

            <DialogFooter className="sm:justify-between">
              {isAdmin ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={deleteM.isPending}>
                      Delete lead
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes the lead for {lead.first_name} {lead.last_name}. This can't be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteM.mutate()}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete lead
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : <span />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void guardedClose()}>Cancel</Button>
                <Button onClick={() => saveM.mutate()} disabled={saveM.isPending || lockedForMe} title={lockedForMe ? `Claimed by ${claimedLabel}` : undefined}>
                  {saveM.isPending ? "Saving…" : lockedForMe ? "Locked" : "Save changes"}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, locked }: { label: string; value: string; locked?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {locked && <Lock className="h-3 w-3" />}
      </div>
      <div className="mt-0.5 text-foreground">{value}</div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8" />
    </div>
  );
}

function formatDob(dob: string | null): string {
  if (!dob) return "—";
  const [y, m, d] = dob.split("-").map(Number);
  if (!y || !m || !d) return dob;
  const dt = new Date(y, m - 1, d);
  const age = Math.floor((Date.now() - dt.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const yy = String(y).slice(-2);
  return `${mm}/${dd}/${yy} (age ${age})`;
}

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return Math.floor((Date.now() - dt.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

type VendorRules = { min_vehicles: number | null; max_age: number | null };

function isOneCarVendor(name?: string | null): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return n.includes("nadir") || n.includes("giga") || n.includes("sm connect");
}

function effectiveRules(vendorName?: string | null, rules?: VendorRules | null): { minVehicles: number; maxAge: number } {
  const minVehicles = rules?.min_vehicles ?? (isOneCarVendor(vendorName) ? 1 : 2);
  const maxAge = rules?.max_age ?? 70;
  return { minVehicles, maxAge };
}

function ViewLeadDialog({ lead, onClose, vendorName, vendorRules }: { lead: Lead | null; onClose: () => void; vendorName?: string; vendorRules?: VendorRules | null }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = useHasRole("admin");
  const currentUserId = user?.id ?? "";
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  useEffect(() => {
    setProofUrl(null);
    if (!lead?.optin_proof_path) return;
    let cancelled = false;
    supabase.storage
      .from("optin-proofs")
      .createSignedUrl(lead.optin_proof_path, 60 * 10)
      .then(({ data }) => {
        if (!cancelled && data?.signedUrl) setProofUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [lead?.optin_proof_path]);
  const deleteM = useMutation({
    mutationFn: async () => {
      if (!lead) return;
      const { error } = await supabase.from("list_leads").delete().eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lead deleted");
      qc.invalidateQueries({ queryKey: ["list_leads"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to delete"),
  });
  return (
    <Dialog open={!!lead} onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" className="w-full sm:max-w-2xl overflow-y-auto flex flex-col gap-4">
        {lead && (
          <>
            <DialogHeader>
              <DialogTitle>
                {lead.first_name} {lead.last_name}
              </DialogTitle>
              <DialogDescription>
                {lead.phone} · {lead.street}, {lead.city}, {lead.state} {lead.zip} · {lead.county} County
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-4 rounded-md border bg-muted/30 p-4 text-sm">
              <Field label="Current carrier" value={lead.current_carrier} />
              <Field label="Vehicles" value={String(lead.num_vehicles)} />
              <Field label="Date of birth" value={formatDob(lead.date_of_birth)} />
              <div className="col-span-2">
                <Field label="Your notes" value={lead.vendor_notes || "—"} />
              </div>
              {lead.optin_proof_path && (
                <div className="col-span-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Proof of opt-in
                  </div>
                  {proofUrl ? (
                    <a
                      href={proofUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-sm text-primary underline"
                    >
                      View uploaded proof
                    </a>
                  ) : (
                    <div className="mt-1 text-sm text-muted-foreground">Loading…</div>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 rounded-md border p-4 text-sm">
              <Field
                label="Quoted premium"
                value={lead.quoted_premium != null ? `$${Number(lead.quoted_premium).toFixed(2)}` : "—"}
              />
              <Field
                label="Current premium"
                value={lead.current_premium != null ? `$${Number(lead.current_premium).toFixed(2)}` : "—"}
              />
              <div className="col-span-2">
                <LeadNotesThread
                  leadId={lead.id}
                  leadTable="list_leads"
                  lineKey="auto"
                  title="Sales agent notes"
                  readOnly
                />
              </div>
            </div>

            <LeadShareSection
              leadId={lead.id}
              leadTable="list_leads"
              claimedBy={lead.claimed_by}
              uid={currentUserId}
            />

            <DialogFooter className="sm:justify-between">
              {isAdmin ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={deleteM.isPending}>
                      Delete lead
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes the lead for {lead.first_name} {lead.last_name} for everyone, including sales agents. This can't be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteM.mutate()}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete lead
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : <span />}
              <Button variant="outline" onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DispoPanelForListLead({ lead }: { lead: Lead }) {
  const qc = useQueryClient();
  const housing: HousingStatus = (lead.housing_status as HousingStatus) ?? null;
  // Normalize casing — vendor payloads ship "Auto"/"HOME"/"Both" and the
  // includes() checks below are case-sensitive, which would hide both panes.
  const lt: string[] = (Array.isArray(lead.lead_types) ? lead.lead_types : [])
    .map((s) => String(s).toLowerCase());
  const hasHomeLine = lt.length === 0
    ? true
    : lt.includes("home") || lt.includes("both") || lead.housing_status === "renter";
  const invalidateKeys: readonly unknown[][] = [["list_leads"]];

  const onHousingChange = async (next: HousingStatus) => {
    const { error } = await (supabase.from("list_leads") as any)
      .update({ housing_status: next })
      .eq("id", lead.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    for (const k of invalidateKeys) qc.invalidateQueries({ queryKey: k });
  };

  const home: SideState = {
    dispo: lead.home_dispo ?? null,
    claimed_by: lead.home_claimed_by ?? null,
    quoted_premium: lead.home_quoted_premium ?? null,
    policies_count: lead.home_policies_count ?? 0,
    follow_up_at: lead.home_follow_up_at ?? null,
    x_date: lead.home_x_date ?? null,
    agent_notes: lead.home_agent_notes ?? null,
  };

  return (
    <div className="space-y-4">
      <LeadSideDispoPanel
        leadId={lead.id}
        source="list_leads"
        housingStatus={housing}
        onHousingChange={onHousingChange}
        home={home}
        showHome={hasHomeLine}
        scriptType={(lead.list_type as ScriptType | null) ?? undefined}
        invalidateKeys={invalidateKeys}
      />
      <LeadExtraLines
        leadId={lead.id}
        source="list_leads"
        invalidateKeys={invalidateKeys}
      />
    </div>
  );
}
