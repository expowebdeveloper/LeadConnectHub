import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useHasRole } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
import {
  DISPO_OPTIONS,
  type Dispo,
  SCRIPT_TYPES,
  type ScriptType,
  CARRIERS,
  HOME_CARRIERS,
  CONSTRUCTION_TYPES,
  ROOF_TYPES,
  US_STATES,
} from "@/lib/constants";
import { LeadSidePane, type SideState, type HousingStatus } from "@/components/LeadSideDispo";
import { LeadNotesThread } from "@/components/LeadNotesThread";
import { useLeadLines, LineSection, CROSS_SELL_LINES } from "@/components/LeadExtraLines";
import { LobReorderable, type LobSlot } from "@/components/LobReorderable";
import { useDispoOptions } from "@/hooks/useDispoOptions";
import { LINE_TYPE_META, type LeadLine, type LineType } from "@/lib/constants";
import { SaleTypeDialog, type SaleType } from "@/components/SaleTypeDialog";

function useViewportWidth() {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined") return () => {};
      window.addEventListener("resize", cb);
      return () => window.removeEventListener("resize", cb);
    },
    () => (typeof window === "undefined" ? 1280 : window.innerWidth),
    () => 1280,
  );
}
import { canCloseLead, dispoRequiresPremium } from "@/lib/closeGuard";
import { VEHICLE_YEARS, VEHICLE_MAKES, VEHICLE_MODELS_BY_MAKE, type Vehicle } from "@/lib/constants";
import { listSalesAgents, lookupVendorNames, claimFirstAdmin } from "@/lib/admin.functions";
import { getLeadBillability } from "@/lib/billing.functions";
import {
  Shield,
  ShieldCheck,
  Plus,
  Pencil,
  Lock,
  Radio,
  Mail,
  Trash2,
  Home as HomeIcon,
  Car,
  FileText,
  Key,
  Umbrella,
  Waves,
  Anchor,
  Bike,
  Caravan,
  Flag,
  UserX,
} from "lucide-react";
import { getCountyAssessorSearchUrl } from "@/lib/countyAssessors";
import { toast } from "sonner";
import { LeadActivityList } from "@/components/LeadActivityList";
import { LeadShareSection } from "@/components/LeadShareSection";
import { LineOwnerControl } from "@/components/LineOwnerControl";
import { ZillowPropertyCard } from "@/components/ZillowPropertyCard";
import { BulkActionBar } from "@/components/BulkActionBar";
import { Checkbox } from "@/components/ui/checkbox";
import { Phone, MessageSquare } from "lucide-react";
import { CallButton } from "@/components/CallButton";
import { EmailLeadButton } from "@/components/EmailLeadButton";
import { TextLeadButton } from "@/components/TextLeadButton";
import { AgentAvatar } from "@/components/AgentAvatar";

export const Route = createFileRoute("/liveleads")({
  head: () => ({
    meta: [
      { title: "Leads — LeadVault" },
      { name: "description", content: "All inbound leads from your call-center vendors." },
    ],
  }),
  component: DashboardPage,
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
  archived_at: string | null;
  created_at: string;
  updated_at?: string | null;
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
  list_type?: string | null;
  lob_order?: string[] | null;
  current_home_carrier?: string | null;
  year_built?: number | null;
  square_feet?: number | null;
  construction_type?: string | null;
  roof_type?: string | null;
  roof_year?: number | null;
  num_stories?: number | null;
  num_bedrooms?: number | null;
  num_bathrooms?: number | null;
  dwelling_value?: number | null;
  has_pool?: boolean | null;
  has_trampoline?: boolean | null;
  claims_last_5y?: number | null;
  mortgage_company?: string | null;
  lead_lines?: LeadLine[] | null;
  not_billable?: boolean | null;
  billable_override?: boolean | null;
};

const CARRIER_BRAND: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  Progressive: { bg: "rgba(0,68,143,0.15)", border: "rgba(0,68,143,0.7)", text: "#5ea8ff", dot: "#0078d4" },
  GEICO: { bg: "rgba(0,166,80,0.15)", border: "rgba(0,166,80,0.7)", text: "#4ade80", dot: "#00a650" },
  "State Farm": { bg: "rgba(220,38,38,0.15)", border: "rgba(220,38,38,0.7)", text: "#f87171", dot: "#dc2626" },
  USAA: { bg: "rgba(0,53,95,0.2)", border: "rgba(0,53,95,0.8)", text: "#7dd3fc", dot: "#00355f" },
  "Liberty Mutual": { bg: "rgba(252,211,77,0.15)", border: "rgba(252,211,77,0.7)", text: "#fcd34d", dot: "#fbbf24" },
  "Direct Auto": { bg: "rgba(234,88,12,0.15)", border: "rgba(234,88,12,0.7)", text: "#fb923c", dot: "#ea580c" },
  "National General": { bg: "rgba(30,64,175,0.15)", border: "rgba(30,64,175,0.7)", text: "#60a5fa", dot: "#1e40af" },
  Travelers: { bg: "rgba(220,38,38,0.15)", border: "rgba(220,38,38,0.7)", text: "#f87171", dot: "#dc2626" },
  Farmers: { bg: "rgba(120,53,15,0.2)", border: "rgba(180,83,9,0.7)", text: "#fbbf24", dot: "#b45309" },
  Nationwide: { bg: "rgba(30,58,138,0.18)", border: "rgba(30,58,138,0.7)", text: "#60a5fa", dot: "#1e3a8a" },
  "Auto-Owners": { bg: "rgba(185,28,28,0.15)", border: "rgba(185,28,28,0.7)", text: "#f87171", dot: "#b91c1c" },
  Safeco: { bg: "rgba(2,132,199,0.15)", border: "rgba(2,132,199,0.7)", text: "#38bdf8", dot: "#0284c7" },
  Mercury: { bg: "rgba(220,38,38,0.15)", border: "rgba(220,38,38,0.7)", text: "#f87171", dot: "#dc2626" },
  Kemper: { bg: "rgba(124,58,237,0.15)", border: "rgba(124,58,237,0.7)", text: "#a78bfa", dot: "#7c3aed" },
  "AAA / Auto Club Group": {
    bg: "rgba(220,38,38,0.15)",
    border: "rgba(220,38,38,0.7)",
    text: "#f87171",
    dot: "#dc2626",
  },
  Amica: { bg: "rgba(30,64,175,0.15)", border: "rgba(30,64,175,0.7)", text: "#60a5fa", dot: "#1e40af" },
  "The Hartford": { bg: "rgba(5,150,105,0.15)", border: "rgba(5,150,105,0.7)", text: "#34d399", dot: "#059669" },
  Allstate: { bg: "rgba(30,64,175,0.18)", border: "rgba(30,64,175,0.7)", text: "#60a5fa", dot: "#1e40af" },
};
const DEFAULT_BRAND = {
  bg: "rgba(100,116,139,0.15)",
  border: "rgba(100,116,139,0.6)",
  text: "#cbd5e1",
  dot: "#94a3b8",
};
function getCarrierBrand(name: string) {
  return CARRIER_BRAND[name] || DEFAULT_BRAND;
}

function formatListType(t: string | null | undefined): string {
  if (!t) return "";
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function LeadTypeTags({
  source,
  lead,
  vendorName,
}: {
  source: "leads" | "list_leads";
  lead: Lead;
  vendorName?: string;
}) {
  const lt = (Array.isArray(lead.lead_types) ? lead.lead_types : []).map((s) => String(s).toLowerCase());
  const hasAuto = lt.length === 0 || lt.includes("auto") || lt.includes("both");
  const hasHome = lt.length === 0 || lt.includes("home") || lt.includes("both") || lt.includes("renters");
  const extraLines = Array.isArray(lead.lead_lines) ? (lead.lead_lines as LeadLine[]) : [];
  const extraTypes = Array.from(new Set(extraLines.map((l) => l?.type).filter(Boolean))) as LineType[];
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-2">
      {source === "leads" ? (
        <>
          <Badge className="rounded-full border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-300 hover:bg-emerald-500/20">
            <Radio className="mr-1 h-3 w-3" /> Live Lead
          </Badge>
          {vendorName && (
            <Badge
              variant="outline"
              className="rounded-full border-violet-500/40 bg-violet-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-violet-300"
              title={`Vendor: ${vendorName}`}
            >
              Vendor · {vendorName}
            </Badge>
          )}
        </>
      ) : (
        <>
          <Badge className="rounded-full border-slate-500/40 bg-slate-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-300 hover:bg-slate-500/20">
            List Lead
          </Badge>
          {lead.list_type && (
            <Badge
              variant="outline"
              className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {formatListType(lead.list_type)}
            </Badge>
          )}
        </>
      )}
      {hasAuto && (
        <Badge
          variant="outline"
          className="rounded-full border-sky-500/30 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300"
        >
          <Car className="mr-1 h-3 w-3" /> Auto
        </Badge>
      )}
      {hasHome && (
        <Badge
          variant="outline"
          className="rounded-full border-amber-500/30 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300"
        >
          <HomeIcon className="mr-1 h-3 w-3" /> Home
        </Badge>
      )}
      {extraTypes.map((t) => {
        const Icon = EXTRA_LINE_ICONS[t] ?? Umbrella;
        const count = extraLines.filter((l) => l?.type === t).length;
        return (
          <Badge
            key={t}
            variant="outline"
            className="rounded-full border-violet-500/30 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300"
          >
            <Icon className="mr-1 h-3 w-3" /> {LINE_TYPE_META[t]?.label ?? t}
            {count > 1 && <span className="ml-1 opacity-70">×{count}</span>}
          </Badge>
        );
      })}
    </div>
  );
}

const EXTRA_LINE_ICONS: Record<LineType, typeof Umbrella> = {
  umbrella: Umbrella,
  flood: Waves,
  boat: Anchor,
  motorcycle: Bike,
  rv: Caravan,
  golf_cart: Flag,
  auto: Car,
  home: HomeIcon,
};

function DashboardPage() {
  const { user, roles, loading } = useAuth();
  const navigate = useNavigate();
  const isSales = useHasRole("sales", "admin");
  const isVendor = useHasRole("vendor");
  const isAdmin = useHasRole("admin");
  const isTelemarketer = useHasRole("telemarketer");
  const isTelemarketerOnly = isTelemarketer && !isAdmin && !isSales && !isVendor;
  const isPending = roles.length === 1 && roles[0] === "pending";

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!loading && user && isTelemarketerOnly) {
      navigate({ to: "/call-queue", replace: true });
    }
  }, [loading, user, isTelemarketerOnly, navigate]);

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
          Your account has been created. An admin needs to assign you a role (Vendor or Sales Agent) before you can use
          LeadVault.
        </p>
      </CardContent>
    </Card>
  );
}

function LeadsView({ isSales, isVendor, isAdmin }: { isSales: boolean; isVendor: boolean; isAdmin: boolean }) {
  const [search, setSearch] = useState("");
  const [dispoFilter, setDispoFilter] = useState<string>("all");
  const [showArchive, setShowArchive] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [viewing, setViewing] = useState<Lead | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { user } = useAuth();
  const qc = useQueryClient();
  const currentUserId = user?.id ?? "";

  const lookupVendors = useServerFn(lookupVendorNames);
  const fetchAgents = useServerFn(listSalesAgents);

  // Desktop table uses content-aware auto layout with per-column min/max widths
  // (see TableHead classes below) instead of rigid pixel tiers, so the layout
  // reflows smoothly from md up through ultra-wide without leaving empty gaps.

  const leadsQ = useQuery({
    queryKey: isVendor ? ["leads", showArchive, currentUserId] : ["leads", showArchive],
    queryFn: async () => {
      let qb = supabase
        .from("leads")
        .select(
          "agent_id,agent_notes,archived_at,auto_archive,auto_motor_club_premium,auto_policies_count,auto_sale_type,auto_score,billable_override,city,claimed_at,claimed_by,claims_last_5y,composite_score,construction_type,county,created_at,current_carrier,current_home_carrier,current_premium,date_of_birth,dispo,dwelling_value,email,first_name,follow_up_at,has_pool,has_trampoline,home_agent_notes,home_claimed_at,home_claimed_by,home_dispo,home_follow_up_at,home_policies_count,home_quoted_premium,home_sale_type,home_score,home_x_date,housing_status,id,last_name,lead_lines,lead_source,lead_type,lead_types,litigator,lob_order,mortgage_company,num_bathrooms,num_bedrooms,num_stories,num_vehicles,optin_proof_path,phone,quoted_premium,referred_by,roof_type,roof_year,score_breakdown,score_tier,scored_at,square_feet,state,street,transferred_by,updated_at,vehicles,vendor_id,vendor_notes,x_date,year_built,zip",
        )
        .order("created_at", { ascending: false });
      if (showArchive) {
        qb = qb.not("archived_at", "is", null);
      } else {
        qb = qb.is("archived_at", null);
      }
      if (isVendor) {
        qb = qb.eq("vendor_id", currentUserId);
      }
      const { data, error } = await qb;
      if (error) throw error;
      const rows = (data ?? []) as unknown as Lead[];
      for (const r of rows) (r as Lead & { _source?: string })._source = "leads";
      // In archive view, also include missed-transfer leads that the daily
      // cron moved from `leads` into `list_leads`. These rows were never
      // claimed and are no longer in the live `leads` table.
      if (showArchive) {
        let missedQb = supabase
          .from("list_leads")
          .select(
            "agent_id,agent_notes,archived_at,auto_archive,auto_motor_club_premium,auto_policies_count,auto_sale_type,auto_score,billable_override,city,claimed_at,claimed_by,claims_last_5y,composite_score,construction_type,county,created_at,current_carrier,current_home_carrier,current_premium,date_of_birth,dispo,dwelling_value,email,first_name,follow_up_at,has_pool,has_trampoline,home_agent_notes,home_claimed_at,home_claimed_by,home_dispo,home_follow_up_at,home_policies_count,home_quoted_premium,home_sale_type,home_score,home_x_date,housing_status,id,import_batch_id,last_name,lead_lines,lead_source,lead_type,lead_types,list_type,list_type_priority,litigator,mortgage_company,not_billable,num_bathrooms,num_bedrooms,num_stories,num_vehicles,phone,quoted_premium,referred_by,roof_type,roof_year,score_breakdown,score_tier,scored_at,source_row,square_feet,state,street,transferred_at,transferred_by,transferred_lead_id,updated_at,vehicles,vendor_id,vendor_notes,x_date,year_built,zip",
          )
          .eq("list_type", "missed_transfer")
          .order("created_at", { ascending: false });
        if (isVendor) {
          missedQb = missedQb.eq("vendor_id", currentUserId);
        }
        const { data: missed, error: missedErr } = await missedQb;
        if (missedErr) throw missedErr;
        for (const m of (missed ?? []) as unknown as Record<string, unknown>[]) {
          rows.push({
            id: String(m.id),
            vendor_id: String(m.vendor_id),
            first_name: (m.first_name as string) ?? "",
            last_name: (m.last_name as string) ?? "",
            phone: (m.phone as string) ?? "",
            email: (m.email as string) ?? "",
            date_of_birth: (m.date_of_birth as string) ?? "",
            street: (m.street as string) ?? "",
            city: (m.city as string) ?? "",
            state: (m.state as string) ?? "",
            zip: (m.zip as string) ?? "",
            county: (m.county as string) ?? "",
            current_carrier: (m.current_carrier as string) ?? "",
            num_vehicles: (m.num_vehicles as number) ?? 0,
            vendor_notes: (m.vendor_notes as string | null) ?? null,
            vehicles: ((m.vehicles as Vehicle[] | null) ?? []) as Vehicle[],
            dispo: (m.dispo as Lead["dispo"]) ?? null,
            quoted_premium: (m.quoted_premium as number | null) ?? null,
            current_premium: (m.current_premium as number | null) ?? null,
            vendor_payout: (m.vendor_payout as number | null) ?? null,
            agent_id: (m.agent_id as string | null) ?? null,
            agent_notes: (m.agent_notes as string | null) ?? null,
            optin_proof_path: null,
            claimed_by: (m.claimed_by as string | null) ?? null,
            claimed_at: (m.claimed_at as string | null) ?? null,
            follow_up_at: (m.follow_up_at as string | null) ?? null,
            x_date: (m.x_date as string | null) ?? null,
            archived_at: (m.created_at as string) ?? null,
            created_at: (m.created_at as string) ?? new Date().toISOString(),
            not_billable: (m.not_billable as boolean | null) ?? null,
            billable_override: (m.billable_override as boolean | null) ?? null,
            _source: "list_leads",
          } as Lead & { _source: string });
        }
        rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      }
      return rows;
    },
  });

  // Realtime: push new vendor submissions and updates to all open dashboards instantly.
  useEffect(() => {
    const channel = supabase
      .channel("dashboard-leads")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => {
        if (isVendor) {
          qc.invalidateQueries({ queryKey: ["leads", false, currentUserId] });
          qc.invalidateQueries({ queryKey: ["leads", true, currentUserId] });
        } else {
          qc.invalidateQueries({ queryKey: ["leads"] });
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, isVendor, currentUserId]);

  const vendorIds = useMemo(
    () => Array.from(new Set((leadsQ.data ?? []).map((l) => l.vendor_id).filter((x): x is string => !!x))),
    [leadsQ.data],
  );

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

  // Some leads may be claimed/assigned to users that aren't in the sales-agent
  // list (e.g. admins, ex-sales). Fetch their profiles so the "Assigned" badge
  // and avatar still resolves in the lead dialogs and table.
  const ownerIds = useMemo(() => {
    const set = new Set<string>();
    for (const l of leadsQ.data ?? []) {
      if (l.claimed_by) set.add(l.claimed_by);
      if (l.agent_id) set.add(l.agent_id);
    }
    for (const a of agentsQ.data ?? []) set.delete(a.id);
    return Array.from(set);
  }, [leadsQ.data, agentsQ.data]);

  const ownerProfilesQ = useQuery({
    queryKey: ["lead-owner-profiles", ownerIds],
    queryFn: async () => {
      if (ownerIds.length === 0)
        return [] as Array<{ id: string; full_name: string | null; email: string; avatar_url: string | null }>;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url")
        .in("id", ownerIds);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; full_name: string | null; email: string; avatar_url: string | null }>;
    },
    enabled: isSales && ownerIds.length > 0,
  });

  const allAgents = useMemo(
    () => [...(agentsQ.data ?? []), ...(ownerProfilesQ.data ?? [])],
    [agentsQ.data, ownerProfilesQ.data],
  );

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

  const resolveVendorRules = (vendorId: string): { min_vehicles: number | null; max_age: number | null } => {
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
    for (const a of allAgents)
      m.set(a.id, {
        name: a.full_name || a.email,
        avatar_url: (a as { avatar_url?: string | null }).avatar_url ?? null,
      });
    return m;
  }, [allAgents]);

  const claimM = useMutation({
    mutationFn: async ({ id, claim }: { id: string; claim: boolean }) => {
      const payload = claim
        ? { claimed_by: currentUserId, claimed_at: new Date().toISOString(), agent_id: currentUserId }
        : { claimed_by: null, claimed_at: null, agent_id: null };
      const { error } = await supabase.from("leads").update(payload).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.claim ? "Lead claimed" : "Lead released");
      if (isVendor) {
        qc.invalidateQueries({ queryKey: ["leads", false, currentUserId] });
        qc.invalidateQueries({ queryKey: ["leads", true, currentUserId] });
      } else {
        qc.invalidateQueries({ queryKey: ["leads"] });
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update claim"),
  });

  const filtered = useMemo(() => {
    if (!leadsQ.data) return [];
    let base = leadsQ.data;
    if (isSales && dispoFilter !== "all") {
      if (dispoFilter === "follow_up_due") {
        const now = Date.now();
        base = base.filter(
          (l) => l.dispo === "follow_up" && l.follow_up_at && new Date(l.follow_up_at).getTime() <= now,
        );
      } else if (dispoFilter === "none") {
        base = base.filter((l) => !l.dispo);
      } else {
        base = base.filter((l) => l.dispo === dispoFilter);
      }
    }
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((l) =>
      [l.first_name, l.last_name, l.phone, l.city, l.state, l.zip, l.current_carrier]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [leadsQ.data, search, isSales, dispoFilter]);

  // Build a set of phone numbers that appear more than once (across visible leads)
  const duplicatePhones = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of leadsQ.data ?? []) {
      const n = (l.phone || "").replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
      if (n.length >= 7) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const dups = new Set<string>();
    for (const [k, v] of counts) if (v > 1) dups.add(k);
    return dups;
  }, [leadsQ.data]);

  const isDuplicate = (phone: string) => {
    const n = (phone || "").replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
    return duplicatePhones.has(n);
  };

  // A live lead is "on call" when it has a claim that's still fresh and
  // undisposed. Stale claims (days old) don't count. We use claimed_by (not
  // agent_id) because agent_id is also set by vendor/owner assignment. Some
  // older/live rows can have a null claimed_at, so fall back to the row's
  // most recent lead timestamp to keep the UI badge aligned with presence.
  const ON_CALL_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  // Only the single most-recent fresh, undisposed claim per agent counts as
  // "On Call". Without this, an agent who claims multiple leads in a window
  // (e.g. opens one without dispoing, then claims another) would show the
  // On Call badge on every one of them.
  const onCallLeadIdByAgent = useMemo(() => {
    const cutoff = Date.now() - ON_CALL_MAX_AGE_MS;
    const newestByAgent = new Map<string, { id: string; ts: number }>();
    for (const l of leadsQ.data ?? []) {
      if (!l.claimed_by || l.dispo) continue;
      const ts = new Date(l.claimed_at ?? l.updated_at ?? l.created_at).getTime();
      if (Number.isNaN(ts) || ts < cutoff) continue;
      const cur = newestByAgent.get(l.claimed_by);
      if (!cur || ts > cur.ts) newestByAgent.set(l.claimed_by, { id: l.id, ts });
    }
    return newestByAgent;
  }, [leadsQ.data]);
  const isOnCallLead = (l: Lead) => !!l.claimed_by && !l.dispo && onCallLeadIdByAgent.get(l.claimed_by)?.id === l.id;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = (rows: Lead[]) => {
    setSelectedIds((prev) => {
      const allSelected = rows.every((r) => prev.has(r.id));
      if (allSelected) return new Set();
      return new Set(rows.map((r) => r.id));
    });
  };

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            <span className="relative inline-flex">
              <span className="absolute inset-0 rounded-full bg-emerald-400/30 blur-md animate-pulse" />
              <Radio className="relative h-6 w-6 text-emerald-400 md:h-7 md:w-7" />
            </span>
            <span className="text-xl font-extrabold uppercase tracking-tight md:text-2xl">
              {isSales ? (
                showArchive ? (
                  <>
                    <span className="text-foreground">ARCHIVED </span>
                    <span className="text-emerald-400">LEADS</span>
                  </>
                ) : (
                  <>
                    <span className="text-foreground">LIVE </span>
                    <span className="text-emerald-400">LEADS</span>
                  </>
                )
              ) : (
                <>
                  <span className="text-foreground">YOUR </span>
                  <span className="text-emerald-400">LEADS</span>
                </>
              )}
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-400 animate-pulse">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
              Live Feed
            </span>
          </span>
        }
        action={
          <div className="flex items-center gap-2">
            {isSales && (
              <Select value={dispoFilter} onValueChange={setDispoFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Filter dispo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All dispos</SelectItem>
                  <SelectItem value="follow_up_due">Follow-ups due</SelectItem>
                  <SelectItem value="none">No dispo</SelectItem>
                  {DISPO_OPTIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isVendor && (
              <Button asChild>
                <Link to="/leads/new">
                  <Plus className="h-4 w-4" /> New lead
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <Card className="overflow-hidden rounded-2xl border-emerald-500/30 shadow-[0_0_60px_-10px_rgba(52,211,153,0.35)] bg-background/40">
        <CardContent className="p-0">
          {leadsQ.isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading leads…</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No leads yet.
              {isVendor && (
                <>
                  {" "}
                  <Link to="/leads/new" className="font-medium text-accent underline-offset-4 hover:underline">
                    Submit your first lead
                  </Link>
                  .
                </>
              )}
            </div>
          ) : (
            <>
              <ul className="md:hidden divide-y">
                {filtered.map((l) => {
                  const mine =
                    (!!l.claimed_by && l.claimed_by === currentUserId) ||
                    (!!l.agent_id && l.agent_id === currentUserId);
                  const claimed = !!l.claimed_by || !!l.agent_id;
                  const canOpen = !isSales || isAdmin || mine;
                  const accent = mine
                    ? "border-l-4 border-l-emerald-500 bg-emerald-50/60"
                    : claimed
                      ? "border-l-4 border-l-amber-400 bg-amber-50/30"
                      : "border-l-4 border-l-emerald-400 bg-emerald-50/30";
                  return (
                    <li
                      key={l.id}
                      className={`${accent} p-3 ${canOpen ? "cursor-pointer active:bg-muted/40" : "opacity-80"}`}
                      onClick={() => {
                        if (isSales) {
                          if (!canOpen) return;
                          setEditing(l);
                        } else setViewing(l);
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold truncate">
                              {l.first_name} {l.last_name}
                            </span>
                            {isDuplicate(l.phone) && (
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-amber-100 text-amber-900 border-amber-200"
                              >
                                Dup
                              </Badge>
                            )}
                            {!canOpen && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground truncate">
                            {l.city}, {l.state} {l.zip} ·{" "}
                            <span className="text-emerald-300">{l.current_carrier || "—"}</span> · {l.num_vehicles} veh
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {resolveVendorName(l.vendor_id) ?? "—"} ·{" "}
                            {new Date(l.created_at).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            })}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <DispoBadge dispo={l.dispo} />
                          {notBillableReasons(l, resolveVendorName(l.vendor_id), resolveVendorRules(l.vendor_id))
                            .length > 0 && (
                            <span className="inline-flex w-fit rounded-sm border border-rose-200/80 bg-rose-50/80 px-1 py-px text-[7px] font-medium uppercase leading-none tracking-[0.06em] text-rose-700">
                              Not billable
                            </span>
                          )}
                        </div>
                      </div>
                      <div
                        className="mt-2 flex items-center justify-between gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {l.phone && user ? (
                          <CallButton
                            leadId={l.id}
                            leadTable="leads"
                            phone={l.phone}
                            uid={user.id}
                            dnc={l.dispo === "dnc"}
                            className="!text-sm text-emerald-300"
                          >
                            <Phone className="h-3.5 w-3.5 mr-1 inline" />
                            {l.phone}
                          </CallButton>
                        ) : (
                          <span className="text-sm text-muted-foreground">{l.phone || "No phone"}</span>
                        )}
                        {isSales && !claimed && (
                          <Button
                            size="sm"
                            onClick={() => {
                              claimM.mutate({ id: l.id, claim: true });
                              setEditing({ ...l, claimed_by: currentUserId, agent_id: currentUserId });
                            }}
                            disabled={claimM.isPending}
                          >
                            Claim
                          </Button>
                        )}
                        {isSales && mine && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => claimM.mutate({ id: l.id, claim: false })}
                            disabled={claimM.isPending}
                          >
                            Unclaim
                          </Button>
                        )}
                        {isSales &&
                          claimed &&
                          !mine &&
                          (() => {
                            const a = l.claimed_by ? agentMap.get(l.claimed_by) : undefined;
                            return (
                              <span className="flex items-center gap-1.5 text-xs text-muted-foreground truncate max-w-[50%]">
                                <AgentAvatar size="xs" name={a?.name} path={a?.avatar_url} />
                                <span className="flex flex-col items-start leading-tight min-w-0">
                                  <span className="truncate">{a?.name ?? "Claimed"}</span>
                                  {isOnCallLead(l) && <OnCallBadge className="mt-0.5" />}
                                </span>
                              </span>
                            );
                          })()}
                      </div>
                      {l.dispo === "follow_up" && l.follow_up_at && (
                        <div className="mt-2">
                          <FollowUpBadge at={l.follow_up_at} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="hidden md:block">
                <Table className="w-full [&_tr]:border-white/5">
                  <TableHeader>
                    <TableRow className="border-b border-white/5 hover:bg-transparent">
                      {isSales && (
                        <TableHead className="w-8 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                          <Checkbox
                            checked={filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id))}
                            onCheckedChange={() => toggleSelectAll(filtered)}
                            aria-label="Select all"
                          />
                        </TableHead>
                      )}
                      {(
                        [
                          "Vendor",
                          "Name",
                          "Location",
                          "Contact",
                          "Veh.",
                          "Dispo",
                          "Premium",
                          "Received",
                          "Agent",
                        ] as const
                      ).map((h, i) => {
                        if (h === "Vendor" && !isSales) return null;
                        if (h === "Agent" && !isSales) return null;
                        const align = h === "Veh." || h === "Premium" ? "text-center" : "";
                        const center = h === "Received" ? "text-center" : "";
                        const w =
                          h === "Vendor"
                            ? "min-w-[120px] max-w-[180px]"
                            : h === "Name"
                              ? "min-w-[120px]"
                              : h === "Location"
                                ? "min-w-[160px]"
                                : h === "Contact"
                                  ? "min-w-[180px] max-w-[260px]"
                                  : h === "Veh."
                                    ? "w-[56px]"
                                    : h === "Dispo"
                                      ? "min-w-[96px] max-w-[140px]"
                                      : h === "Premium"
                                        ? "w-[88px]"
                                        : h === "Received"
                                          ? "w-[96px]"
                                          : h === "Agent"
                                            ? "min-w-[120px] max-w-[180px]"
                                            : "";
                        return (
                          <TableHead
                            key={i}
                            className={`px-2 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-400/80 ${align} ${center} ${w}`}
                          >
                            {h}
                          </TableHead>
                        );
                      })}
                      <TableHead className="w-full" aria-hidden />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((l) => {
                      const mine =
                        (!!l.claimed_by && l.claimed_by === currentUserId) ||
                        (!!l.agent_id && l.agent_id === currentUserId);
                      const claimed = !!l.claimed_by || !!l.agent_id;
                      const canOpen = !isSales || isAdmin || mine;
                      const baseCls = `group transition-all [&>td]:align-middle [&>td]:py-3 [&>td]:px-2 ${canOpen ? "cursor-pointer" : "cursor-not-allowed"}`;
                      const rowCls = mine
                        ? `${baseCls} bg-emerald-500/10 hover:bg-emerald-500/15`
                        : claimed && isSales
                          ? `${baseCls} opacity-60 hover:opacity-100 hover:bg-muted/30`
                          : `${baseCls} hover:bg-emerald-500/[0.05]`;
                      const fresh = Date.now() - new Date(l.created_at).getTime() < 30 * 60 * 1000;
                      return (
                        <TableRow
                          key={l.id}
                          className={rowCls}
                          onClick={() => {
                            if (isSales) {
                              if (!canOpen) return;
                              setEditing(l);
                            } else {
                              setViewing(l);
                            }
                          }}
                        >
                          {isSales && (
                            <TableCell onClick={(e) => e.stopPropagation()} className="!py-2.5">
                              <Checkbox
                                checked={selectedIds.has(l.id)}
                                onCheckedChange={() => toggleSelect(l.id)}
                                aria-label="Select lead"
                              />
                            </TableCell>
                          )}
                          {isSales && (
                            <TableCell>
                              <span className="block break-words leading-tight text-[11px] font-bold uppercase tracking-wider text-foreground/90">
                                {vendorMap.get(l.vendor_id) ?? "—"}
                              </span>
                            </TableCell>
                          )}
                          <TableCell>
                            <div className="flex flex-col">
                              <span
                                className={`truncate text-[13px] font-bold uppercase tracking-tight ${claimed && !mine ? "text-muted-foreground" : "text-foreground"}`}
                              >
                                {l.first_name} {l.last_name}
                              </span>
                              {isDuplicate(l.phone) && (
                                <Badge
                                  variant="outline"
                                  className="mt-1.5 w-fit rounded-md border border-amber-500/60 bg-amber-500/15 px-2 py-0.5 font-bold uppercase tracking-wider text-[10px] text-amber-400"
                                >
                                  Duplicate
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex min-w-0 flex-col gap-1 leading-tight">
                              <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-foreground/90">
                                {l.city}, {l.state} <span className="font-mono text-muted-foreground/60">{l.zip}</span>
                              </span>
                              {l.current_carrier ? (
                                <span className="inline-flex w-fit max-w-full items-center truncate rounded-md border border-emerald-500/40 bg-emerald-500/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                                  {l.current_carrier}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div
                              className="flex min-h-[64px] min-w-0 flex-col justify-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {l.phone && user ? (
                                <div className="inline-flex w-fit min-w-0 max-w-full items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/[0.04] py-0.5 pl-0.5 pr-2 transition-all group-hover:border-emerald-400/70 group-hover:bg-emerald-500/[0.08] group-hover:shadow-[0_0_14px_rgba(52,211,153,0.25)]">
                                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10">
                                    <Phone className="h-3 w-3 text-emerald-400" />
                                  </span>
                                  <CallButton
                                    leadId={l.id}
                                    leadTable="leads"
                                    phone={l.phone}
                                    uid={user.id}
                                    dnc={l.dispo === "dnc"}
                                    className="min-w-0 truncate whitespace-nowrap bg-transparent hover:bg-transparent px-0 py-0 h-auto text-emerald-300 hover:text-emerald-200 font-mono text-[12px] font-semibold tracking-wide"
                                  >
                                    {l.phone}
                                  </CallButton>
                                </div>
                              ) : null}
                              {l.email && (
                                <div className="inline-flex w-fit min-w-0 max-w-full items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/[0.04] py-0.5 pl-0.5 pr-2 transition-all group-hover:border-emerald-400/70 group-hover:bg-emerald-500/[0.08] group-hover:shadow-[0_0_14px_rgba(52,211,153,0.25)]">
                                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10">
                                    <Mail className="h-3 w-3 text-emerald-400" />
                                  </span>
                                  <EmailLeadButton
                                    email={l.email}
                                    leadId={l.id}
                                    leadTable="leads"
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
                                    vendorNotes={isSales ? l.vendor_notes : undefined}
                                    className="inline-flex min-w-0 max-w-full items-center justify-start truncate rounded-md px-0 py-0 bg-transparent hover:bg-transparent text-emerald-300 hover:text-emerald-200 font-mono text-[12px] font-semibold tracking-wide"
                                  />
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="font-mono text-base font-bold tabular-nums text-foreground">
                              {l.num_vehicles}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col items-start gap-1">
                              <DispoBadge dispo={l.dispo} />
                              {notBillableReasons(l, resolveVendorName(l.vendor_id), resolveVendorRules(l.vendor_id))
                                .length > 0 && (
                                <div className="inline-flex w-fit rounded-sm border border-rose-200/80 bg-rose-50/80 px-1 py-px text-[7px] font-medium uppercase leading-none tracking-[0.06em] text-rose-700">
                                  Not billable
                                </div>
                              )}
                            </div>
                            {l.dispo === "follow_up" && l.follow_up_at && (
                              <div className="mt-1">
                                <FollowUpBadge at={l.follow_up_at} />
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {l.quoted_premium != null ? (
                              <span className="font-mono text-sm font-bold tabular-nums text-emerald-300">
                                ${Number(l.quoted_premium).toFixed(0)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-center">
                            <div
                              className="flex items-center justify-center gap-1.5"
                              title={new Date(l.created_at).toLocaleString()}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${fresh ? "bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.9)]" : "bg-emerald-500/60"}`}
                              />
                              <span
                                className={`font-mono text-xs font-bold tabular-nums ${fresh ? "text-emerald-300" : "text-foreground"}`}
                              >
                                {new Date(l.created_at).toLocaleTimeString(undefined, {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  hour12: false,
                                })}
                              </span>
                            </div>
                          </TableCell>
                          {isSales && (
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              {!claimed && (
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    claimM.mutate({ id: l.id, claim: true });
                                    setEditing({ ...l, claimed_by: currentUserId, agent_id: currentUserId });
                                  }}
                                  disabled={claimM.isPending}
                                  className="h-7 gap-1 bg-emerald-500 text-black hover:bg-emerald-400 font-bold text-[11px] uppercase tracking-wider"
                                >
                                  Claim
                                </Button>
                              )}
                              {mine && (
                                <div className="flex flex-col items-start gap-1">
                                  <div className="flex items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className="rounded-md border border-emerald-500/60 bg-emerald-500/15 px-2 py-0.5 font-bold uppercase tracking-wider text-[10px] text-emerald-300"
                                    >
                                      Yours
                                    </Badge>
                                    <button
                                      type="button"
                                      onClick={() => claimM.mutate({ id: l.id, claim: false })}
                                      disabled={claimM.isPending}
                                      className="text-xs text-muted-foreground underline-offset-2 hover:underline hover:text-foreground"
                                    >
                                      Release
                                    </button>
                                  </div>
                                  {isOnCallLead(l) && <OnCallBadge />}
                                </div>
                              )}
                              {claimed &&
                                !mine &&
                                (() => {
                                  const a =
                                    (l.claimed_by ? agentMap.get(l.claimed_by) : undefined) ??
                                    (l.agent_id ? agentMap.get(l.agent_id) : undefined);
                                  const firstName = a?.name?.split(" ")[0];
                                  return (
                                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                      <AgentAvatar size="xs" name={a?.name} path={a?.avatar_url} />
                                      <span className="flex flex-col items-start leading-tight min-w-0">
                                        <span className="truncate">{firstName ?? "Claimed"}</span>
                                        {isOnCallLead(l) && <OnCallBadge className="mt-0.5" />}
                                      </span>
                                    </span>
                                  );
                                })()}
                            </TableCell>
                          )}
                          <TableCell aria-hidden className="w-full p-0" />
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {isSales && (
        <EditLeadDialog
          lead={editing ? ((leadsQ.data ?? []).find((l) => l.id === editing.id) ?? editing) : null}
          onClose={() => setEditing(null)}
          agents={allAgents}
          vendorName={editing ? resolveVendorName(editing.vendor_id) : undefined}
          vendorRules={editing ? resolveVendorRules(editing.vendor_id) : undefined}
        />
      )}
      {isSales && (
        <BulkActionBar
          table="leads"
          selectedIds={Array.from(selectedIds)}
          selectedClaimMap={new Map((leadsQ.data ?? []).map((lead) => [lead.id, lead.claimed_by ?? null]))}
          onClear={() => setSelectedIds(new Set())}
          agents={agentsQ.data ?? []}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          listLeadIds={
            new Set(
              (leadsQ.data ?? [])
                .filter((r) => (r as Lead & { _source?: string })._source === "list_leads")
                .map((r) => r.id),
            )
          }
        />
      )}
      {isVendor && !isSales && (
        <ViewLeadDialog
          lead={viewing}
          onClose={() => setViewing(null)}
          vendorName={viewing ? resolveVendorName(viewing.vendor_id) : undefined}
          vendorRules={viewing ? resolveVendorRules(viewing.vendor_id) : undefined}
          agents={allAgents}
        />
      )}
    </>
  );
}

function DispoBadge({ dispo }: { dispo: Dispo | null }) {
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
  return (
    <Badge variant="outline" className={`${cls[dispo]} whitespace-nowrap`}>
      {label}
    </Badge>
  );
}

function OnCallBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-md border border-emerald-500/60 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300 " +
        className
      }
      title="Agent is on a call — waiting for disposition"
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
      On call
    </span>
  );
}

function FollowUpBadge({ at }: { at: string }) {
  const t = new Date(at).getTime();
  const overdue = t <= Date.now();
  const label = new Date(at)
    .toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(",", " ·");
  return (
    <span
      className={
        "inline-flex w-fit items-center whitespace-nowrap rounded-sm border px-1 py-px text-[7px] font-medium uppercase leading-none tracking-[0.06em] " +
        (overdue
          ? "border-rose-200/80 bg-rose-50/80 text-rose-700"
          : "border-amber-200/80 bg-amber-50/80 text-amber-700")
      }
      title={overdue ? "Overdue follow-up" : "Scheduled follow-up"}
    >
      {label}
    </span>
  );
}

function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

export function EditLeadDialog({
  lead,
  onClose,
  agents,
  vendorName,
  vendorRules,
  source = "leads",
  invalidateKeys,
  preferredLob,
}: {
  lead: Lead | null;
  onClose: () => void;
  agents: Array<{ id: string; full_name: string | null; email: string; avatar_url?: string | null }>;
  vendorName?: string;
  vendorRules?: VendorRules | null;
  source?: "leads" | "list_leads";
  invalidateKeys?: readonly unknown[][];
  preferredLob?: "auto" | "home";
}) {
  const qc = useQueryClient();
  // When mounted from a host (e.g. My Leads) that uses non-standard query
  // keys, the host passes those keys so every write here refetches the
  // right data. Defaults to `[[source]]` so dashboard/shark-tank continue
  // to invalidate `["leads"]` / `["list_leads"]` via prefix match.
  const invKeys: readonly unknown[][] = invalidateKeys && invalidateKeys.length > 0 ? invalidateKeys : [[source]];
  const invalidateAll = () => {
    for (const k of invKeys) qc.invalidateQueries({ queryKey: k });
  };
  const isAdmin = useHasRole("admin");
  const isSales = useHasRole("sales", "admin");
  const { user } = useAuth();
  const currentUserId = user?.id ?? "";
  const claimedByOther = !!lead?.claimed_by && lead.claimed_by !== currentUserId;
  const assignedToOther = !!lead?.agent_id && lead.agent_id !== currentUserId;
  const homeClaimedByOther = !!(lead as any)?.home_claimed_by && (lead as any).home_claimed_by !== currentUserId;
  // When the user is working the Home line (e.g. opened from Shark Tank "Home"
  // tab), the dialog must not be locked just because another agent owns the
  // Auto side. Lock criteria follow the active line of business instead.
  const lockedForMe =
    preferredLob === "home" ? homeClaimedByOther && !isAdmin : (claimedByOther || assignedToOther) && !isAdmin;
  const claimedAgent = lead?.claimed_by ? agents.find((a) => a.id === lead.claimed_by) : null;
  const claimedLabel = claimedAgent ? claimedAgent.full_name || claimedAgent.email : "another agent";
  const fetchBillability = useServerFn(getLeadBillability);
  const billabilityQ = useQuery({
    queryKey: ["lead-billability", source, lead?.id],
    queryFn: () => fetchBillability({ data: { lead_id: lead!.id, source } }),
    enabled: !!lead?.id,
    staleTime: 30_000,
  });
  const notBillable = billabilityQ.data && billabilityQ.data.billable === false;
  const notBillableReason = billabilityQ.data?.reasons?.[0] ?? "";
  const [current, setCurrent] = useState("");
  const [quoted, setQuoted] = useState("");
  const [dispo, setDispo] = useState<Dispo | "">("");
  const [followUp, setFollowUp] = useState("");
  const [pendingFollowUp, setPendingFollowUp] = useState(false);
  const [pendingFollowUpAt, setPendingFollowUpAt] = useState("");
  const [pendingSale, setPendingSale] = useState(false);
  // Forced premium prompt when an agent picks a quote-implying dispo
  // (Quoted, X-Date, etc.) with no premium on file. `next` is the dispo
  // we'll persist once a valid premium is entered.
  const [pendingPremium, setPendingPremium] = useState<Dispo | null>(null);
  const [pendingPremiumAmt, setPendingPremiumAmt] = useState("");
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
  const [editingPhone, setEditingPhone] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [headerEditOpen, setHeaderEditOpen] = useState(false);
  const [viewHousing, setViewHousing] = useState<HousingStatus>((lead?.housing_status as HousingStatus) ?? null);
  // Imperative handle wired up by DispoPanelForDashboardLead so the
  // Auto section header switch can drive the same on/off + confirm
  // dialog flow as the Lines of Business card.
  const autoToggleRef = useRef<((next: boolean) => void) | null>(null);
  // Shared helper used by both the LoB Home/Renters card and the Home
  // section header switch so the two stay in lockstep.
  const persistHousing = async (next: HousingStatus) => {
    if (!lead) return;
    const prev = viewHousing;
    setViewHousing(next);
    qc.setQueriesData<Lead[]>({ queryKey: [source] }, (old) => {
      if (!Array.isArray(old)) return old as any;
      return old.map((l) => (l.id === lead.id ? { ...l, housing_status: next } : l));
    });
    const { error } = await (supabase.from(source) as any).update({ housing_status: next }).eq("id", lead.id);
    if (error) {
      setViewHousing(prev);
      toast.error(error.message);
    }
    invalidateAll();
  };
  // Auto pane is always available on live leads so agents can cross-sell
  // even when the vendor posted a home/renter-only lead.
  const hasAuto = true;
  // Home/Renters slots are always available (like Auto) so any lead can
  // toggle housing on/off and add a Home policy regardless of lead_types.
  const hasHomeLine = true;

  // Shared lead-lines fetch so the left column can render individual line
  // sections in any order the agent has chosen on the right.
  const {
    lines: extraLines,
    updateLine: updateExtraLine,
    removeLine: removeExtraLine,
  } = useLeadLines(lead?.id ?? "", source, invKeys);
  const { options: dispoOptions } = useDispoOptions();

  // Compute the ordered list of LOB slot keys, applying the saved order
  // first and appending any new active slots at the end.
  const orderedSlots = useMemo(() => {
    const active: string[] = [];
    // Always include the Auto slot so the toggle remains visible even when
    // Auto is turned off — otherwise the agent has no way to turn it back on.
    active.push("auto");
    if (hasHomeLine) {
      active.push("home");
      active.push("renter");
    }
    for (const l of extraLines) active.push(`line:${l.line_id}`);
    const saved = Array.isArray(lead?.lob_order) ? lead!.lob_order! : [];
    const result: string[] = [];
    for (const k of saved) if (active.includes(k) && !result.includes(k)) result.push(k);
    // Back-compat: if saved order has "home" but not "renter", insert "renter" right after "home"
    if (!result.includes("renter") && active.includes("renter")) {
      const homeIdx = result.indexOf("home");
      if (homeIdx !== -1) result.splice(homeIdx + 1, 0, "renter");
      else result.push("renter");
    }
    for (const k of active) if (!result.includes(k)) result.push(k);
    // Default: when opened from the Home shark tank prefer Home first;
    // otherwise Auto goes first. Agent's saved ordering always wins.
    if (preferredLob === "home" && !saved.includes("home")) {
      const renterIdx = result.indexOf("renter");
      let renter: string | null = null;
      if (renterIdx !== -1) {
        renter = result.splice(renterIdx, 1)[0];
      }
      const homeIdx = result.indexOf("home");
      if (homeIdx > 0) {
        result.splice(homeIdx, 1);
        result.unshift("home");
      } else if (homeIdx === -1 && active.includes("home")) {
        result.unshift("home");
      }
      if (renter) {
        const newHomeIdx = result.indexOf("home");
        result.splice(newHomeIdx + 1, 0, renter);
      }
    } else if (!saved.includes("auto")) {
      const autoIdx = result.indexOf("auto");
      if (autoIdx > 0) {
        result.splice(autoIdx, 1);
        result.unshift("auto");
      }
    }
    return result;
  }, [hasAuto, hasHomeLine, extraLines, lead?.lob_order, preferredLob]);

  const persistLobOrder = async (next: string[]) => {
    if (!lead) return;
    qc.setQueriesData<Lead[]>({ queryKey: [source] }, (old) => {
      if (!Array.isArray(old)) return old as any;
      return old.map((l) => (l.id === lead.id ? { ...l, lob_order: next } : l));
    });
    const { error } = await (supabase.from(source) as any).update({ lob_order: next }).eq("id", lead.id);
    if (error) {
      toast.error(error.message);
      invalidateAll();
    }
  };

  const guardedClose = async () => {
    if (!lead) return onClose();
    // Wait for any in-flight claim/save so canCloseLead reads the same row
    // state the agent just produced (avoids a race where the dialog closes
    // before the auto-claim commits, leaving an orphan undisposed claim).
    try {
      if (autoClaimM.isPending) await autoClaimM.mutateAsync(true).catch(() => {});
    } catch {
      /* no-op */
    }
    try {
      if (saveM.isPending) await new Promise((r) => setTimeout(r, 50));
    } catch {
      /* no-op */
    }
    const ok = await canCloseLead(source, lead.id, currentUserId, isAdmin);
    if (ok) onClose();
  };

  useEffect(() => {
    if (lead) {
      setCurrent(lead.current_premium != null ? String(lead.current_premium) : "");
      setQuoted(lead.quoted_premium != null ? String(lead.quoted_premium) : "");
      setDispo(lead.dispo ?? "");
      setFollowUp(lead.follow_up_at ? lead.follow_up_at.slice(0, 16) : "");
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
      if (preferredLob === "home" && !lead.housing_status) {
        setViewHousing("homeowner");
        void persistHousing("homeowner");
      } else {
        setViewHousing((lead.housing_status as HousingStatus) ?? null);
      }
    }
  }, [lead?.id, preferredLob, lead?.dispo, lead?.quoted_premium, lead?.follow_up_at]);

  const updateVehicle = (i: number, patch: Partial<Vehicle>) => {
    setVehicles((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  };
  const addVehicle = () => setVehicles((prev) => [...prev, { year: "", make: "", model: "" }]);
  const removeVehicle = (i: number) => setVehicles((prev) => prev.filter((_, idx) => idx !== i));
  const autoSnapshot = lead
    ? {
        current_carrier: carrier || null,
        num_vehicles: vehicles.length,
        vehicles,
        dispo: dispo || null,
        claimed_by: agentId || null,
        claimed_at: agentId ? (lead.claimed_at ?? new Date().toISOString()) : null,
        quoted_premium: quoted ? Number(quoted) : null,
        follow_up_at: dispo === "follow_up" && followUp ? new Date(followUp).toISOString() : null,
        x_date: lead.x_date ?? null,
        auto_sale_type: (lead as unknown as { auto_sale_type?: SaleType | null }).auto_sale_type ?? null,
        auto_motor_club_premium:
          (lead as unknown as { auto_motor_club_premium?: number | null }).auto_motor_club_premium ?? null,
        auto_policies_count: (lead as unknown as { auto_policies_count?: number | null }).auto_policies_count ?? 0,
      }
    : null;

  const saveM = useMutation({
    mutationFn: async () => {
      if (!lead) return;
      // Auto-side validation only applies when the Auto LOB is active.
      // Home/Renters and extra "second Home" lines persist their own dispo
      // independently, so requiring an Auto dispo when the agent is working
      // a Home line would block the save.
      if (hasAuto) {
        const effectiveDispo = (dispo || lead.dispo || "") as Dispo | "";
        const effectiveQuoted = quoted !== "" ? quoted : lead.quoted_premium != null ? String(lead.quoted_premium) : "";
        const effectiveFollowUp = followUp || (lead.follow_up_at ? lead.follow_up_at.slice(0, 16) : "");
        if (!effectiveDispo) {
          throw new Error("Select a disposition before saving.");
        }
        if (dispoRequiresPremium(effectiveDispo as Dispo)) {
          const n = effectiveQuoted ? Number(effectiveQuoted) : NaN;
          if (!Number.isFinite(n) || n <= 0) {
            throw new Error("Enter a quoted premium before saving.");
          }
        }
        if (effectiveDispo === "follow_up" && !effectiveFollowUp) {
          throw new Error("Pick a follow-up date before saving.");
        }
      }
      const basePatch: Record<string, unknown> = {
        agent_id: agentId || null,
        date_of_birth: dob || null,
        vendor_notes: vendorNotes || null,
        first_name: firstName,
        last_name: lastName,
        phone,
        email: email || null,
        street,
        city,
        state: stateVal,
        zip,
        county,
      };
      // Only write Auto-only columns when Auto is active — otherwise a
      // Home-only save would clobber existing Auto data with empty values.
      // The Auto side pane (LeadSidePane) owns `dispo`, `quoted_premium`,
      // and `follow_up_at` — it auto-saves on change. Writing them here
      // would clobber a freshly-persisted side-pane value with the
      // dialog's stale local state. Only persist the dialog-owned Auto
      // fields (vehicles, carrier, current premium).
      const autoPatch: Record<string, unknown> = hasAuto
        ? {
            current_premium: current ? Number(current) : null,
            vehicles: vehicles as unknown as never,
            num_vehicles: vehicles.length,
            current_carrier: carrier,
          }
        : {};
      const { error } = await (supabase.from(source) as any).update({ ...basePatch, ...autoPatch }).eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lead updated");
      invalidateAll();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  const deleteM = useMutation({
    mutationFn: async () => {
      if (!lead) return;
      const { error } = await supabase.from(source).delete().eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lead deleted");
      invalidateAll();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to delete"),
  });

  const autoClaimM = useMutation({
    mutationFn: async (claim: boolean) => {
      if (!lead) return;
      const payload = claim
        ? { claimed_by: currentUserId, claimed_at: new Date().toISOString(), agent_id: currentUserId }
        : { claimed_by: null, claimed_at: null };
      const { error } = await (supabase.from(source) as any).update(payload).eq("id", lead.id);
      if (error) throw error;
      // Audit the claim so closeGuard can detect that the user worked this
      // lead even after a later release clears `claimed_by`.
      if (claim && currentUserId) {
        await supabase
          .from("lead_activities" as never)
          .insert({
            lead_id: lead.id,
            lead_table: source,
            user_id: currentUserId,
            action: "lead_claimed",
            details: { side: "auto" },
          } as never)
          .then(() => undefined, () => undefined);
      }
    },
    onSuccess: () => {
      invalidateAll();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update claim"),
  });

  // Release whichever line(s) the current user owns and close the dialog so
  // the lead drops back into the pool for someone else to claim.
  const ownsAutoClaim = !!lead?.claimed_by && lead.claimed_by === currentUserId;
  const ownsHomeClaim = !!(lead as any)?.home_claimed_by && (lead as any).home_claimed_by === currentUserId;
  const hasAutoClaim = !!lead?.claimed_by;
  const hasHomeClaim = !!(lead as any)?.home_claimed_by;
  const hasAnyClaim = hasAutoClaim || hasHomeClaim;
  const canReleaseAuto = hasAutoClaim && (isAdmin || ownsAutoClaim);
  const canReleaseHome = hasHomeClaim && (isAdmin || ownsHomeClaim);
  const canRelease = canReleaseAuto || canReleaseHome;
  const claimedByLabel = (() => {
    const ids = [lead?.claimed_by, (lead as any)?.home_claimed_by].filter(Boolean) as string[];
    if (ids.length === 0) return "";
    const names = Array.from(new Set(ids)).map((id) => {
      const a = agents.find((x) => x.id === id);
      return a?.full_name || a?.email || "another agent";
    });
    return names.join(", ");
  })();
  const releaseClaimsM = useMutation({
    mutationFn: async () => {
      if (!lead) return;
      const payload: Record<string, any> = {};
      if (canReleaseAuto) {
        payload.claimed_by = null;
        payload.claimed_at = null;
        payload.agent_id = null;
      }
      if (canReleaseHome) {
        payload.home_claimed_by = null;
        payload.home_claimed_at = null;
      }
      if (Object.keys(payload).length === 0) return;
      const { error } = await (supabase.from(source) as any).update(payload).eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lead released");
      invalidateAll();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to release lead"),
  });

  // Auto-side dispo / follow-up writes. The Auto Disposition pills in this
  // dialog used to only set local state — the main "Save" button omits
  // `dispo` and `follow_up_at`, so picks never reached the DB and the
  // follow-up never showed up on the /follow-ups calendar. Persist
  // immediately on every change, mirroring how the Home side auto-saves.
  const persistAutoDispo = async (patch: Record<string, unknown>) => {
    if (!lead) return;
    const full: Record<string, unknown> = { ...patch };
    if (!lead.claimed_by && currentUserId && patch.dispo) {
      full.claimed_by = currentUserId;
      full.claimed_at = new Date().toISOString();
    }
    const { error } = await (supabase.from(source) as any).update(full).eq("id", lead.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    invalidateAll();
  };

  /**
   * True when this lead has no quoted premium on record — neither persisted
   * on the row nor typed into the Quoted Premium field. Used to gate
   * quote-implying dispos so an agent can't mark a lead "Quoted" (or any
   * dispo that implies a quote was given) without recording what they quoted.
   */
  const hasNoPremium = () => {
    const onFile = lead?.quoted_premium;
    if (onFile != null && Number(onFile) > 0) return false;
    const typed = quoted.trim();
    return typed === "" || !(Number(typed) > 0);
  };

  /**
   * Apply a non-special dispo from the pill picker. Quote-implying dispos
   * (everything except the no-quote outcomes) require a premium first — if
   * none is on file we open the premium prompt and defer persistence until
   * the agent enters one.
   */
  const applyAutoDispo = (value: Dispo) => {
    if (dispoRequiresPremium(value) && hasNoPremium()) {
      setPendingPremiumAmt(quoted.trim());
      setPendingPremium(value);
      return;
    }
    setDispo(value);
    void persistAutoDispo({ dispo: value, follow_up_at: null, x_date: null });
  };

  const confirmPendingPremium = () => {
    const n = Number(pendingPremiumAmt);
    if (!Number.isFinite(n) || n <= 0) {
      toast.warning("Enter a valid quoted premium first.");
      return;
    }
    const next = pendingPremium;
    setQuoted(String(n));
    setPendingPremium(null);
    setPendingPremiumAmt("");
    if (!next) return;
    setDispo(next);
    // Persist premium and dispo together so the row never lands in the
    // "quoted dispo, empty premium" state this gate exists to prevent.
    void persistAutoDispo({
      dispo: next,
      quoted_premium: n,
      follow_up_at: null,
      x_date: null,
    });
  };

  return (
    <Dialog
      open={!!lead}
      onOpenChange={(o) => {
        if (!o) void guardedClose();
      }}
    >
      <DialogContent
        className="max-w-5xl max-h-[92vh] overflow-y-auto rounded-2xl p-0 gap-0"
        onInteractOutside={(e) => {
          // Radix portals nested dialogs/popovers outside this content, so
          // closing one of them fires onInteractOutside here. Don't treat
          // that as the user trying to leave the lead.
          const target = e.target as HTMLElement | null;
          const insideOtherOverlay = !!target?.closest?.(
            '[role="dialog"],[role="alertdialog"],[data-radix-popper-content-wrapper],[data-radix-portal]',
          );
          if (headerEditOpen || pendingFollowUp || pendingSale || pendingPremium || insideOtherOverlay) {
            e.preventDefault();
            return;
          }
          e.preventDefault();
          void guardedClose();
        }}
        onEscapeKeyDown={(e) => {
          if (headerEditOpen || pendingFollowUp || pendingSale || pendingPremium) {
            e.preventDefault();
            return;
          }
          e.preventDefault();
          void guardedClose();
        }}
      >
        {lead && (
          <>
            <DialogHeader className="px-6 pt-6 pb-3 border-b border-border space-y-0">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <DialogTitle className="flex items-center gap-2 text-2xl font-bold tracking-tight uppercase">
                      {firstName} {lastName}
                      {lead.claimed_by && !lead.dispo && <OnCallBadge />}
                      <button
                        type="button"
                        onClick={() => setHeaderEditOpen(true)}
                        className="ml-1 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Edit lead details"
                        aria-label="Edit lead details"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </DialogTitle>
                    <LeadTypeTags source={source} lead={lead} vendorName={vendorName} />
                    {notBillable && <NotBillableInlineBadge reasons={billabilityQ.data?.reasons ?? []} />}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                    {dob &&
                      (() => {
                        // Parse YYYY-MM-DD as calendar parts (no Date ctor) so a
                        // UTC-stored DOB doesn't shift a day in local timezones.
                        const parts = dob.split("-").map(Number);
                        const [yyyy, mo, da] = parts;
                        if (!yyyy || !mo || !da) return null;
                        const today = new Date();
                        let age = today.getFullYear() - yyyy;
                        const m = today.getMonth() - (mo - 1);
                        if (m < 0 || (m === 0 && today.getDate() < da)) age--;
                        const mm = String(mo).padStart(2, "0");
                        const dd = String(da).padStart(2, "0");
                        return (
                          <div className="flex items-center gap-2">
                            <span className="font-semibold tracking-wider text-foreground">
                              {mm}/{dd}/{yyyy}
                            </span>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              {age} years old
                            </span>
                          </div>
                        );
                      })()}
                    <div className="h-4 w-px bg-border" />
                    <DialogDescription className="text-sm text-muted-foreground">
                      {street}, {city}, {stateVal} {zip} · {county} County
                    </DialogDescription>
                    <div className="flex items-center rounded-lg border border-border/70 bg-muted/30 p-0.5">
                      {(["homeowner", "renter"] as const).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={async () => {
                            const next = viewHousing === opt ? null : opt;
                            setViewHousing(next);
                            qc.setQueriesData<Lead[]>({ queryKey: [source] }, (old) => {
                              if (!Array.isArray(old)) return old as any;
                              return old.map((l) => (l.id === lead?.id ? { ...l, housing_status: next } : l));
                            });
                            if (lead) {
                              const { error } = await (supabase.from(source) as any)
                                .update({ housing_status: next })
                                .eq("id", lead.id);
                              if (error) {
                                setViewHousing((lead.housing_status as HousingStatus) ?? null);
                                toast.error(error.message);
                              }
                              invalidateAll();
                            }
                          }}
                          className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-all ${
                            viewHousing === opt
                              ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-stretch gap-3 shrink-0">
                  {source === "leads" && hasAnyClaim && (
                    <button
                      type="button"
                      disabled={releaseClaimsM.isPending || !canRelease}
                      onClick={() => releaseClaimsM.mutate()}
                      title={
                        canRelease
                          ? isAdmin && !ownsAutoClaim && !ownsHomeClaim
                            ? `Release this lead from ${claimedByLabel}`
                            : "Release this lead back to the pool"
                          : `Claimed by ${claimedByLabel}`
                      }
                      className="group inline-flex items-center gap-1.5 self-center rounded-xl border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-amber-300 transition-all hover:bg-amber-500/20 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <UserX className="h-3.5 w-3.5" />
                      Unclaim
                    </button>
                  )}
                  {/* Hero CTA: Call */}
                  {/* Hero CTA: Email */}
                  {editingEmail ? (
                    <div className="flex min-w-[220px] items-center gap-2 rounded-2xl border border-border bg-muted/30 p-3">
                      <Input
                        autoFocus
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@example.com"
                        className="h-10 flex-1 text-sm"
                      />
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditingEmail(false)}>
                        Done
                      </Button>
                    </div>
                  ) : email ? (
                    <EmailLeadButton
                      email={email}
                      leadId={lead.id}
                      leadTable={source}
                      firstName={firstName}
                      lastName={lastName}
                      phone={phone}
                      carrier={carrier}
                      city={city}
                      state={stateVal}
                      zip={zip}
                      quotedPremium={lead.quoted_premium ?? null}
                      currentPremium={current ? Number(current) : null}
                      vehicles={vehicles}
                      vendorNotes={isSales ? vendorNotes : undefined}
                      className="group flex min-w-[220px] items-center gap-3 rounded-2xl border border-border bg-muted/30 p-4 text-left text-foreground no-underline transition-all hover:bg-muted/60 hover:scale-[1.01] active:scale-[0.99]"
                      stopPropagation={false}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground transition-colors group-hover:text-foreground">
                        <Mail className="h-5 w-5" />
                      </span>
                      <span className="flex flex-col items-start min-w-0 flex-1">
                        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                          Email
                        </span>
                        <span className="text-sm font-black tracking-tight truncate w-full">{email}</span>
                      </span>
                    </EmailLeadButton>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingEmail(true)}
                      className="group flex min-w-[220px] items-center gap-3 rounded-2xl border border-dashed border-border bg-muted/20 p-4 text-left transition-all hover:bg-muted/40"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                        <Mail className="h-5 w-5" />
                      </span>
                      <span className="flex flex-col items-start min-w-0">
                        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                          Email
                        </span>
                        <span className="text-lg font-black tracking-tight text-foreground">Add email</span>
                      </span>
                    </button>
                  )}

                  {/* Hero CTA: Phone */}
                  {editingPhone ? (
                    <div className="flex min-w-[220px] items-center gap-2 rounded-2xl border border-border bg-muted/30 p-3">
                      <Input
                        autoFocus
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="Phone"
                        className="h-10 flex-1 text-sm"
                      />
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditingPhone(false)}>
                        Done
                      </Button>
                    </div>
                  ) : phone && lead && currentUserId ? (
                    <CallButton
                      leadId={lead.id}
                      leadTable={source}
                      phone={phone}
                      uid={currentUserId}
                      stopPropagation={false}
                      dnc={(lead.dispo as string | null) === "dnc"}
                      className="group !flex min-w-[220px] items-center gap-3 rounded-2xl bg-primary p-4 !text-primary-foreground shadow-xl shadow-primary/10 transition-all hover:bg-primary/90 hover:!no-underline hover:scale-[1.01] active:scale-[0.99]"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/10 text-primary-foreground transition-transform group-hover:scale-110">
                        <Phone className="h-5 w-5" />
                      </span>
                      <span className="flex flex-col items-start min-w-0">
                        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-primary-foreground/70">
                          Primary phone
                        </span>
                        <span className="text-lg font-black tracking-tight truncate">{phone}</span>
                      </span>
                    </CallButton>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingPhone(true)}
                      className="group flex min-w-[220px] items-center gap-3 rounded-2xl border border-dashed border-border bg-muted/20 p-4 text-left transition-all hover:bg-muted/40"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                        <Phone className="h-5 w-5" />
                      </span>
                      <span className="flex flex-col items-start min-w-0">
                        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                          Primary phone
                        </span>
                        <span className="text-lg font-black tracking-tight text-foreground">Add phone</span>
                      </span>
                    </button>
                  )}

                  {/* Compact CTA: Text via Hearsay (minimized — feature is flaky) */}
                  {phone && lead && (lead.dispo as string | null) !== "dnc" && (
                    <TextLeadButton
                      phone={phone}
                      leadId={lead.id}
                      leadTable={source}
                      firstName={firstName}
                      lastName={lastName}
                      carrier={carrier}
                      city={city}
                      state={stateVal}
                      quotedPremium={lead.quoted_premium}
                      currentPremium={lead.current_premium}
                      vehicles={vehicles}
                      stopPropagation={false}
                      className="group inline-flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-full border border-border bg-muted/30 text-muted-foreground transition-all hover:bg-muted/60 hover:text-foreground hover:scale-105 active:scale-95"
                    >
                      <MessageSquare className="h-4 w-4" />
                    </TextLeadButton>
                  )}
                </div>
              </div>
            </DialogHeader>

            <div className="grid grid-cols-12 gap-8 p-6">
              {/* LEFT COLUMN — each LOB block uses CSS `order` so it matches
                  the agent's chosen order from the right-column reorder list. */}
              <div className="col-span-12 lg:col-span-8 flex flex-col gap-8">
                {hasAuto && (
                  <div style={{ order: orderedSlots.indexOf("auto") }} className="flex flex-col gap-8">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <h2 className="text-5xl font-bold tracking-tight text-foreground">Auto</h2>
                        {(() => {
                          const brand = getCarrierBrand(carrier);
                          const hasCarrier = !!carrier;
                          return (
                            <Select value={carrier || undefined} onValueChange={setCarrier}>
                              <SelectTrigger
                                className="inline-flex h-8 w-fit items-center gap-2 rounded-full border border-dashed px-4 text-sm font-semibold tracking-wide transition-colors hover:opacity-90 focus:ring-0 focus:ring-offset-0 [&>svg]:hidden data-[state=open]:opacity-90"
                                style={
                                  hasCarrier
                                    ? {
                                        borderColor: brand.border,
                                        backgroundColor: brand.bg,
                                        color: brand.text,
                                        borderStyle: "solid",
                                      }
                                    : undefined
                                }
                              >
                                {hasCarrier ? (
                                  <SelectValue placeholder="Set carrier" />
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                    <Plus className="h-3.5 w-3.5" />
                                    Set carrier
                                  </span>
                                )}
                              </SelectTrigger>
                              <SelectContent className="max-h-80 rounded-2xl border-border/60 bg-popover/80 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl">
                                {CARRIERS.map((c) => {
                                  const b = getCarrierBrand(c);
                                  return (
                                    <SelectItem
                                      key={c}
                                      value={c}
                                      className="group my-0.5 rounded-xl px-2.5 py-2 text-sm font-medium tracking-tight transition-colors focus:bg-muted/60 data-[state=checked]:bg-muted/40 data-[state=checked]:font-semibold"
                                    >
                                      <span className="inline-flex items-center gap-2.5">
                                        <span
                                          className="inline-block h-2 w-2 rounded-full ring-2 ring-transparent transition-all group-hover:ring-white/10"
                                          style={{ backgroundColor: b.dot }}
                                        />
                                        <span>{c}</span>
                                      </span>
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          );
                        })()}
                      </div>
                      <div className="flex items-center gap-3">
                        <LineOwnerControl
                          leadId={lead.id}
                          leadTable={source}
                          lineId="auto"
                          claimedBy={lead.claimed_by ?? null}
                          currentUserId={currentUserId}
                          isAdmin={isAdmin}
                          agents={agents}
                          disabled={claimedByOther && !isAdmin}
                          onToggleClaim={(next) => autoClaimM.mutate(next)}
                          onReassign={(agentId) => {
                            void supabase
                              .from(source)
                              .update({
                                claimed_by: agentId,
                                claimed_at: agentId ? new Date().toISOString() : null,
                                agent_id: agentId,
                              })
                              .eq("id", lead.id)
                              .then(({ error }) => {
                                if (error) toast.error(error.message);
                                else {
                                  toast.success(agentId ? "Reassigned" : "Released");
                                  qc.invalidateQueries({ queryKey: [source] });
                                }
                              });
                          }}
                        />
                        <Switch
                          id={`auto-on-${lead.id}`}
                          checked={hasAuto}
                          onCheckedChange={(c) => autoToggleRef.current?.(c)}
                          aria-label={`${hasAuto ? "Turn off" : "Turn on"} Auto`}
                          className={
                            hasAuto ? "data-[state=checked]:bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.4)]" : ""
                          }
                        />
                      </div>
                    </div>

                    <section className="space-y-3">
                      <div className="flex items-center justify-between">
                        <SectionLabel>
                          <span className="inline-flex items-center gap-1.5">
                            <Car className="h-3.5 w-3.5 text-cyan-500" />
                            Vehicles ({vehicles.length})
                          </span>
                        </SectionLabel>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {vehicles.map((v, i) => {
                          const models = v.make ? (VEHICLE_MODELS_BY_MAKE[v.make] ?? []) : [];
                          return (
                            <div
                              key={i}
                              className="group relative rounded-xl border border-cyan-500/20 bg-gradient-to-br from-card to-cyan-500/5 p-3 shadow-sm transition-all duration-200 hover:shadow-md hover:border-cyan-500/40"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <span className="inline-flex items-center rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-500">
                                  Vehicle {i + 1}
                                </span>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => removeVehicle(i)}
                                  className="h-5 w-5 shrink-0 rounded-full text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10"
                                  aria-label="Remove vehicle"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500/10 to-cyan-500/0 border border-cyan-500/10">
                                  <Car className="h-9 w-9 text-cyan-500/60" strokeWidth={1.5} />
                                </div>
                                <div className="flex-1 min-w-0 space-y-1">
                                  <div className="flex items-baseline gap-2">
                                    <span className="w-10 text-[8px] font-bold uppercase tracking-[0.18em] text-cyan-500/70">
                                      Year
                                    </span>
                                    <Select value={v.year} onValueChange={(val) => updateVehicle(i, { year: val })}>
                                      <SelectTrigger className="h-5 flex-1 justify-start gap-0 border-0 bg-transparent p-0 text-left text-sm font-bold text-foreground shadow-none hover:text-cyan-500 focus:ring-0 focus:ring-offset-0 [&>svg]:hidden">
                                        <SelectValue placeholder="—" />
                                      </SelectTrigger>
                                      <SelectContent className="max-h-72">
                                        {VEHICLE_YEARS.map((y) => (
                                          <SelectItem key={y} value={y}>
                                            {y}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="flex items-baseline gap-2">
                                    <span className="w-10 text-[8px] font-bold uppercase tracking-[0.18em] text-cyan-500/70">
                                      Make
                                    </span>
                                    <Select
                                      value={v.make}
                                      onValueChange={(val) => updateVehicle(i, { make: val, model: "" })}
                                    >
                                      <SelectTrigger className="h-5 flex-1 justify-start gap-0 border-0 bg-transparent p-0 text-left text-sm font-bold text-foreground shadow-none hover:text-cyan-500 focus:ring-0 focus:ring-offset-0 [&>svg]:hidden">
                                        <SelectValue placeholder="—" />
                                      </SelectTrigger>
                                      <SelectContent className="max-h-72">
                                        {VEHICLE_MAKES.map((m) => (
                                          <SelectItem key={m} value={m}>
                                            {m}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="flex items-baseline gap-2">
                                    <span className="w-10 text-[8px] font-bold uppercase tracking-[0.18em] text-cyan-500/70">
                                      Model
                                    </span>
                                    <Select
                                      value={v.model}
                                      onValueChange={(val) => updateVehicle(i, { model: val })}
                                      disabled={!v.make}
                                    >
                                      <SelectTrigger className="h-5 flex-1 justify-start gap-0 border-0 bg-transparent p-0 text-left text-sm font-bold text-foreground shadow-none hover:text-cyan-500 focus:ring-0 focus:ring-offset-0 disabled:opacity-50 [&>svg]:hidden">
                                        <SelectValue placeholder="—" />
                                      </SelectTrigger>
                                      <SelectContent className="max-h-72">
                                        {models.map((m) => (
                                          <SelectItem key={m} value={m}>
                                            {m}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {vehicles.length === 0 && (
                          <div className="rounded-lg border-2 border-dashed border-border/60 bg-muted/20 p-6 text-center text-xs text-muted-foreground">
                            No vehicles. Click "Add vehicle" to add one.
                          </div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={addVehicle}
                        className="text-xs text-cyan-600 hover:text-cyan-700 hover:bg-cyan-50 -ml-2 h-7 px-2"
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" /> Add vehicle
                      </Button>
                    </section>

                    <section>
                      <div className="relative flex items-center gap-4 rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-card/40 to-cyan-500/[0.04] px-4 py-3 backdrop-blur-md">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10">
                          <FileText className="h-5 w-5 text-cyan-400" />
                        </div>
                        <div className="flex flex-1 items-center justify-between gap-4">
                          <div className="flex-1 text-center">
                            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                              Current Premium
                            </div>
                            <div className="mt-0.5 flex items-baseline justify-center gap-0.5 text-2xl font-bold text-foreground">
                              <span className="text-muted-foreground/70">$</span>
                              <Input
                                type="number"
                                step="0.01"
                                inputMode="decimal"
                                value={current}
                                onChange={(e) => setCurrent(e.target.value)}
                                onBlur={() => {
                                  if (!lead) return;
                                  const t = current.trim();
                                  const n = t === "" ? null : Number(t);
                                  if (n != null && !Number.isFinite(n)) return;
                                  if ((lead.current_premium ?? null) === n) return;
                                  void persistAutoDispo({ current_premium: n });
                                }}
                                placeholder="0.00"
                                className="h-auto w-24 border-0 bg-transparent p-0 text-center font-bold text-2xl tabular-nums tracking-tight text-foreground shadow-none placeholder:text-muted-foreground/30 focus-visible:ring-0 focus-visible:ring-offset-0"
                              />
                            </div>
                          </div>
                          <div className="flex-1 text-center">
                            <div className="text-[11px] font-medium uppercase tracking-wider text-cyan-400">
                              Quoted Premium
                            </div>
                            <div className="mt-0.5 flex items-baseline justify-center gap-0.5 text-2xl font-bold text-cyan-400">
                              <span className="text-cyan-400/70">$</span>
                              <Input
                                type="number"
                                step="0.01"
                                inputMode="decimal"
                                value={quoted}
                                onChange={(e) => setQuoted(e.target.value)}
                                onBlur={() => {
                                  if (!lead) return;
                                  const t = quoted.trim();
                                  const n = t === "" ? null : Number(t);
                                  if (n != null && !Number.isFinite(n)) return;
                                  const effectiveDispo = (dispo || lead.dispo || "") as Dispo | "";
                                  if (
                                    (n == null || !(n > 0)) &&
                                    effectiveDispo &&
                                    dispoRequiresPremium(effectiveDispo as Dispo)
                                  ) {
                                    toast.warning("This disposition requires a quoted premium.");
                                    setQuoted(
                                      lead.quoted_premium != null ? String(lead.quoted_premium) : "",
                                    );
                                    return;
                                  }
                                  if ((lead.quoted_premium ?? null) === n) return;
                                  void persistAutoDispo({ quoted_premium: n });
                                }}
                                placeholder="0.00"
                                className="h-auto w-24 border-0 bg-transparent p-0 text-center font-bold text-2xl tabular-nums tracking-tight text-cyan-400 shadow-none placeholder:text-cyan-400/30 focus-visible:ring-0 focus-visible:ring-offset-0"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-cyan-500/20 bg-cyan-500/10">
                          <ShieldCheck className="h-5 w-5 text-cyan-400" />
                        </div>
                      </div>
                    </section>

                    <section className="space-y-3">
                      <SectionLabel accent="amber">Disposition</SectionLabel>
                      <div className="flex flex-wrap gap-1.5">
                        {DISPO_OPTIONS.map((d) => {
                          const active = dispo === d.value;
                          const activeCls = "border-cyan-500/70 bg-transparent text-cyan-400";
                          return (
                            <button
                              key={d.value}
                              type="button"
                              onClick={() => {
                                if (active) {
                                  setDispo("");
                                  if (d.value === "follow_up") setFollowUp("");
                                  void persistAutoDispo({ dispo: null, follow_up_at: null, x_date: null });
                                  return;
                                }
                                if (d.value === "sold") {
                                  setPendingSale(true);
                                  return;
                                }
                                if (d.value === "follow_up") {
                                  setPendingFollowUpAt(
                                    followUp || (lead?.follow_up_at ? lead.follow_up_at.slice(0, 16) : ""),
                                  );
                                  setPendingFollowUp(true);
                                  return;
                                }
                                applyAutoDispo(d.value as Dispo);
                              }}
                              className={`group relative h-8 rounded-full border px-3 text-xs font-medium tracking-wide transition-all ${
                                active
                                  ? activeCls
                                  : "border-border/60 bg-transparent text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                              }`}
                            >
                              {d.label}
                            </button>
                          );
                        })}
                      </div>
                      {dispo === "follow_up" && followUp && (
                        <p className="text-[11px] text-amber-400/80">
                          Follow-up scheduled for{" "}
                          {new Date(followUp).toLocaleString([], {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                          <button
                            type="button"
                            onClick={() => {
                              setPendingFollowUpAt(followUp);
                              setPendingFollowUp(true);
                            }}
                            className="ml-2 underline hover:text-amber-300"
                          >
                            change
                          </button>
                        </p>
                      )}
                    </section>
                    {isSales && (
                      <section className="space-y-2">
                        <SectionLabel accent="rose">Vendor notes</SectionLabel>
                        <div className="relative">
                          <Textarea
                            rows={3}
                            maxLength={1000}
                            ref={autoResize}
                            onInput={(e) => autoResize(e.currentTarget)}
                            value={vendorNotes}
                            onChange={(e) => setVendorNotes(e.target.value)}
                            className="rounded-xl pr-16"
                          />
                          <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-muted-foreground/60 tabular-nums">
                            {vendorNotes.length} / 1000
                          </span>
                        </div>
                      </section>
                    )}
                    <section className="space-y-2">
                      <SectionLabel accent="cyan">Agent notes</SectionLabel>
                      {lead && <LeadNotesThread leadTable={source} leadId={lead.id} lineKey="auto" />}
                    </section>
                  </div>
                )}

                {lead && viewHousing && (
                  <div style={{ order: orderedSlots.indexOf(viewHousing === "renter" ? "renter" : "home") }}>
                    <DashboardHomeSection
                      lead={lead}
                      housingOverride={viewHousing}
                      source={source}
                      onTurnOff={() => {
                        void persistHousing(null);
                      }}
                      invalidateKeys={invKeys}
                    />
                  </div>
                )}
                {lead &&
                  extraLines.map((line) => (
                    <div key={line.line_id} style={{ order: orderedSlots.indexOf(`line:${line.line_id}`) }}>
                      <LineSection
                        line={line}
                        userId={currentUserId || null}
                        isAdmin={isAdmin}
                        dispoOptions={dispoOptions}
                        onUpdate={(patch) => updateExtraLine(line.line_id, patch)}
                        onRemove={() => removeExtraLine(line.line_id)}
                        leadId={lead.id}
                        leadTable={source}
                        primaryAddress={{
                          street: lead.street ?? "",
                          city: lead.city ?? "",
                          state: lead.state ?? "",
                          zip: lead.zip ?? "",
                        }}
                      />
                    </div>
                  ))}
              </div>

              {/* RIGHT COLUMN */}
              <div className="col-span-12 lg:col-span-4 space-y-8 lg:border-l lg:border-border/60 lg:pl-8">
                <section className="space-y-3">
                  <SectionLabel>Lines of Business</SectionLabel>
                  <DispoPanelForDashboardLead
                    lead={lead}
                    housing={viewHousing}
                    source={source}
                    invalidateKeys={invKeys}
                    onHousingChange={(next) => {
                      void persistHousing(next);
                    }}
                    onAutoToggleReady={(toggle) => {
                      autoToggleRef.current = toggle;
                    }}
                    autoSnapshot={autoSnapshot}
                    orderedSlots={orderedSlots}
                    onReorder={persistLobOrder}
                    onFocusSelected={() => {
                      requestAnimationFrame(() => {
                        document
                          .getElementById(`dashboard-home-section-${lead.id}`)
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      });
                    }}
                  />
                </section>
              </div>
            </div>

            <div className="px-6 pb-6">
              <section className="space-y-3 rounded-lg border bg-muted/20 p-4">
                <SectionLabel>Activity history</SectionLabel>
                <LeadActivityList leadId={lead.id} leadTable={source} />
              </section>
            </div>

            <DialogFooter className="sm:justify-between p-6 border-t border-border bg-muted/20">
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
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void guardedClose()}>
                  Cancel
                </Button>
                <Button
                  onClick={() => saveM.mutate()}
                  disabled={saveM.isPending || lockedForMe}
                  title={lockedForMe ? `Claimed by ${claimedLabel}` : undefined}
                >
                  {saveM.isPending ? "Saving…" : lockedForMe ? "Locked" : "Save changes"}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
      <AlertDialog open={pendingFollowUp} onOpenChange={(o) => !o && setPendingFollowUp(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set follow-up date & time</AlertDialogTitle>
            <AlertDialogDescription>
              A follow-up disposition requires a scheduled date and time so this lead lands on your follow-ups queue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1 py-2">
            <Label className="text-xs">Follow-up at</Label>
            <Input
              type="datetime-local"
              value={pendingFollowUpAt}
              onChange={(e) => setPendingFollowUpAt(e.target.value)}
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!pendingFollowUpAt}
              onClick={(e) => {
                e.preventDefault();
                if (!pendingFollowUpAt) return;
                setFollowUp(pendingFollowUpAt);
                setDispo("follow_up");
                setPendingFollowUp(false);
                void persistAutoDispo({
                  dispo: "follow_up",
                  follow_up_at: new Date(pendingFollowUpAt).toISOString(),
                  x_date: null,
                });
              }}
            >
              Save follow-up
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={pendingPremium !== null}
        onOpenChange={(o) => {
          if (!o) {
            setPendingPremium(null);
            setPendingPremiumAmt("");
          }
        }}
      >
        <AlertDialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Enter quoted premium</AlertDialogTitle>
            <AlertDialogDescription>
              This disposition means a quote was given, so we need the quoted premium on record before setting it. Enter
              the Auto premium you quoted the prospect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1 py-2">
            <Label className="text-xs">Quoted premium</Label>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              autoFocus
              value={pendingPremiumAmt}
              onChange={(e) => setPendingPremiumAmt(e.target.value)}
              placeholder="$0"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmPendingPremium();
                }
              }}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmPendingPremium();
              }}
              disabled={
                !pendingPremiumAmt || !Number.isFinite(Number(pendingPremiumAmt)) || Number(pendingPremiumAmt) <= 0
              }
            >
              Save premium &amp; continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SaleTypeDialog
        open={pendingSale}
        side="auto"
        defaultValue={(lead as unknown as { auto_sale_type?: SaleType | null })?.auto_sale_type ?? null}
        defaultMotorClubPremium={
          (lead as unknown as { auto_motor_club_premium?: number | null })?.auto_motor_club_premium ?? null
        }
        premium={quoted.trim() === "" ? (lead?.quoted_premium ?? null) : Number(quoted)}
        leadName={lead ? `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() : null}
        onCancel={() => setPendingSale(false)}
        onConfirm={async ({ saleType, motorClubPremium, premium: confirmedPremium }) => {
          if (!lead) return;
          setPendingSale(false);
          setDispo("sold");
          setQuoted(String(confirmedPremium));
          setFollowUp("");
          const patch: Record<string, unknown> = {
            dispo: "sold",
            auto_sale_type: saleType,
            quoted_premium: confirmedPremium,
            auto_motor_club_premium: motorClubPremium ?? null,
            follow_up_at: null,
            x_date: null,
          };
          if (!lead.claimed_by && currentUserId) {
            patch.claimed_by = currentUserId;
            patch.claimed_at = new Date().toISOString();
          }
          const { error } = await supabase
            .from(source)
            .update(patch as never)
            .eq("id", lead.id);
          if (error) {
            toast.error(error.message);
            return;
          }
          toast.success("Sale confirmed — broadcasting to performance");
          invalidateAll();
        }}
      />
      <EditLeadHeaderDialog
        open={headerEditOpen}
        onOpenChange={setHeaderEditOpen}
        lead={lead}
        source={source}
        onSaved={(patch) => {
          if (patch.first_name !== undefined) setFirstName(patch.first_name ?? "");
          if (patch.last_name !== undefined) setLastName(patch.last_name ?? "");
          if (patch.phone !== undefined) setPhone(patch.phone ?? "");
          if (patch.email !== undefined) setEmail(patch.email ?? "");
          if (patch.date_of_birth !== undefined) setDob(patch.date_of_birth ?? "");
          if (patch.street !== undefined) setStreet(patch.street ?? "");
          if (patch.city !== undefined) setCity(patch.city ?? "");
          if (patch.state !== undefined) setStateVal(patch.state ?? "");
          if (patch.zip !== undefined) setZip(patch.zip ?? "");
          if (patch.county !== undefined) setCounty(patch.county ?? "");
          if (patch.housing_status !== undefined) setViewHousing((patch.housing_status as HousingStatus) ?? null);
          invalidateAll();
        }}
      />
    </Dialog>
  );
}

type HeaderPatch = Partial<{
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
  housing_status: HousingStatus;
}>;

function EditLeadHeaderDialog({
  open,
  onOpenChange,
  lead,
  source,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: Lead | null;
  source: "leads" | "list_leads";
  onSaved: (patch: HeaderPatch) => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [stateVal, setStateVal] = useState("");
  const [zip, setZip] = useState("");
  const [county, setCounty] = useState("");
  const [housing, setHousing] = useState<HousingStatus>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !lead) return;
    setFirstName(lead.first_name ?? "");
    setLastName(lead.last_name ?? "");
    setPhone(lead.phone ?? "");
    setEmail(lead.email ?? "");
    setDob(lead.date_of_birth ?? "");
    setStreet(lead.street ?? "");
    setCity(lead.city ?? "");
    setStateVal(lead.state ?? "");
    setZip(lead.zip ?? "");
    setCounty(lead.county ?? "");
    setHousing((lead.housing_status as HousingStatus) ?? null);
  }, [open, lead]);

  async function handleSave() {
    if (!lead) return;
    const patch: HeaderPatch = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phone.trim(),
      email: email.trim() ? email.trim() : null,
      date_of_birth: dob || null,
      street: street.trim(),
      city: city.trim(),
      state: stateVal.trim().toUpperCase(),
      zip: zip.trim(),
      county: county.trim(),
      housing_status: housing,
    };
    setSaving(true);
    const { error } = await (supabase.from(source) as any).update(patch).eq("id", lead.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Lead details updated");
    onSaved(patch);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit lead details</DialogTitle>
          <DialogDescription>Update the lead's contact, address, and housing info.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>First name</Label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Last name</Label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Phone</Label>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Date of birth</Label>
            <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Housing</Label>
            <Select
              value={housing ?? "none"}
              onValueChange={(v) => setHousing(v === "none" ? null : (v as HousingStatus))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                <SelectItem value="homeowner">Homeowner</SelectItem>
                <SelectItem value="renter">Renter</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Street</Label>
            <Input value={street} onChange={(e) => setStreet(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>City</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>State</Label>
            <Select value={stateVal || undefined} onValueChange={setStateVal}>
              <SelectTrigger>
                <SelectValue placeholder="State" />
              </SelectTrigger>
              <SelectContent>
                {US_STATES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>ZIP</Label>
            <Input value={zip} onChange={(e) => setZip(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>County</Label>
            <Input value={county} onChange={(e) => setCounty(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
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

function SectionLabel({
  children,
  accent = "cyan",
}: {
  children: React.ReactNode;
  accent?: "cyan" | "rose" | "emerald" | "amber";
}) {
  const dot =
    accent === "rose"
      ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.45)]"
      : accent === "emerald"
        ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.45)]"
        : accent === "amber"
          ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.45)]"
          : "bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.45)]";
  const text =
    accent === "rose"
      ? "text-rose-500"
      : accent === "emerald"
        ? "text-emerald-500"
        : accent === "amber"
          ? "text-amber-500"
          : "text-cyan-500";
  return (
    <h3 className={`flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.18em] ${text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </h3>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8"
      />
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
  void dt;
  return `${mm}/${dd}/${yy} (age ${age})`;
}

function isOver70(dob: string | null): boolean {
  if (!dob) return false;
  const [y, m, d] = dob.split("-").map(Number);
  if (!y || !m || !d) return false;
  const dt = new Date(y, m - 1, d);
  const age = Math.floor((Date.now() - dt.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return age >= 70;
}

function isOneCarVendor(name?: string | null): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return n.includes("nadir") || n.includes("giga") || n.includes("sm connect");
}

type VendorRules = { min_vehicles: number | null; max_age: number | null };

function effectiveRules(
  vendorName?: string | null,
  rules?: VendorRules | null,
): { minVehicles: number; maxAge: number } {
  const minVehicles = rules?.min_vehicles ?? (isOneCarVendor(vendorName) ? 1 : 2);
  const maxAge = rules?.max_age ?? 70;
  return { minVehicles, maxAge };
}

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const [y, mo, da] = dob.split("-").map(Number);
  if (!y || !mo || !da) return null;
  const now = new Date();
  let age = now.getFullYear() - y;
  const m = now.getMonth() - (mo - 1);
  if (m < 0 || (m === 0 && now.getDate() < da)) age--;
  return age;
}

function notBillableReasons(
  lead: {
    date_of_birth: string | null;
    quoted_premium: number | null;
    agent_notes?: string | null;
    dispo: Dispo | null;
    num_vehicles: number;
    current_carrier?: string | null;
  },
  vendorName?: string | null,
  rules?: VendorRules | null,
): string[] {
  const reasons: string[] = [];
  if (lead.dispo === "not_quoted") reasons.push("Lead was marked not quoted.");
  if (lead.dispo === "voicemail") reasons.push("Left voicemail.");
  if (lead.dispo === "already_has_allstate") reasons.push("Has Allstate — not billable.");
  const { minVehicles, maxAge } = effectiveRules(vendorName, rules);
  if ((lead.num_vehicles ?? 0) < minVehicles) {
    reasons.push(
      `Vehicle count is ${lead.num_vehicles ?? 0} — this vendor must submit at least ${minVehicles} ${minVehicles === 1 ? "vehicle" : "vehicles"}.`,
    );
  }
  const age = ageFromDob(lead.date_of_birth);
  if (age != null && age > maxAge) {
    reasons.push(`Customer is ${age} — this vendor's max age is ${maxAge}.`);
  }
  const carrierNorm = (lead.current_carrier ?? "").trim().toLowerCase();
  if (carrierNorm === "allstate") {
    reasons.push("Already has Allstate — not billable.");
  }
  return reasons;
}

function NotBillableBadge({
  lead,
  vendorName,
  vendorRules,
}: {
  lead: Lead;
  vendorName?: string;
  vendorRules?: VendorRules | null;
}) {
  const [open, setOpen] = useState(false);
  const reasons = notBillableReasons(lead, vendorName, vendorRules);
  if (reasons.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mr-1 inline-flex items-center rounded-sm border border-dashed border-rose-400 bg-transparent px-1 py-0 text-[9px] font-semibold uppercase tracking-wide leading-none text-rose-700 hover:bg-rose-50"
      >
        Not Billable
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Why this lead is not billable</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <ul className="list-disc pl-5 space-y-1">
                {reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function NotBillableInlineBadge({ reasons }: { reasons: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Why this lead is not billable"
        className="inline-flex items-center rounded-full border border-red-500/40 bg-red-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-red-300 transition-colors hover:bg-red-500/25 hover:text-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
      >
        Not Billable
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Why this lead is not billable</AlertDialogTitle>
            <AlertDialogDescription asChild>
              {reasons.length > 0 ? (
                <ul className="list-disc pl-5 space-y-1">
                  {reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              ) : (
                <p>No specific reasons reported.</p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ViewLeadDialog({
  lead,
  onClose,
  vendorName,
  vendorRules,
  agents,
}: {
  lead: Lead | null;
  onClose: () => void;
  vendorName?: string;
  vendorRules?: VendorRules | null;
  agents?: Array<{ id: string; full_name: string | null; email: string; avatar_url?: string | null }>;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = useHasRole("admin");
  const isSales = useHasRole("sales", "admin");
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
      const { error } = await supabase.from("leads").delete().eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lead deleted");
      qc.invalidateQueries({ queryKey: ["leads"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to delete"),
  });
  return (
    <Dialog open={!!lead} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {lead && (
          <>
            <DialogHeader className="flex flex-row items-start justify-between gap-4">
              <div className="min-w-0 space-y-1.5 flex-1">
                <DialogTitle>
                  {lead.first_name} {lead.last_name}
                </DialogTitle>
                <DialogDescription>
                  {lead.phone} · {lead.street}, {lead.city}, {lead.state} {lead.zip} · {lead.county} County
                </DialogDescription>
              </div>
              {(() => {
                const ownerId = lead.claimed_by || lead.agent_id;
                if (!ownerId || !agents) return null;
                const owner = agents.find((a) => a.id === ownerId);
                if (!owner) return null;
                const name = owner.full_name || owner.email;
                return (
                  <div className="flex items-center gap-2 rounded-full border border-border bg-muted/40 pl-1 pr-3 py-1 shrink-0">
                    <AgentAvatar size="sm" name={name} path={owner.avatar_url} />
                    <div className="leading-tight">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Agent</div>
                      <div className="text-xs font-semibold text-foreground truncate max-w-[160px]">{name}</div>
                    </div>
                  </div>
                );
              })()}
            </DialogHeader>

            <div className="grid grid-cols-2 gap-4 rounded-md border bg-muted/30 p-4 text-sm">
              <Field label="Current carrier" value={lead.current_carrier} />
              <Field label="Vehicles" value={String(lead.num_vehicles)} />
              <Field label="Date of birth" value={formatDob(lead.date_of_birth)} />
              {isSales && (
                <div className="col-span-2">
                  <Field label="Your notes" value={lead.vendor_notes || "—"} />
                </div>
              )}
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
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  Dispo
                  <Lock className="h-3 w-3" />
                </div>
                <div className="mt-1">
                  <NotBillableBadge lead={lead} vendorName={vendorName} vendorRules={vendorRules} />
                  <DispoBadge dispo={lead.dispo} />
                </div>
              </div>
              <Field
                label="Quoted premium"
                value={lead.quoted_premium != null ? `$${Number(lead.quoted_premium).toFixed(2)}` : "—"}
              />
              <Field
                label="Current premium"
                value={lead.current_premium != null ? `$${Number(lead.current_premium).toFixed(2)}` : "—"}
              />
              <div className="col-span-2">
                <Field label="Sales agent notes" value={lead.agent_notes || "—"} locked />
              </div>
            </div>

            <LeadShareSection leadId={lead.id} leadTable="leads" claimedBy={lead.claimed_by} uid={currentUserId} />

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
                        This permanently removes the lead for {lead.first_name} {lead.last_name} for everyone, including
                        sales agents. This can't be undone.
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
              ) : (
                <span />
              )}
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DispoPanelForDashboardLead({
  lead,
  housing,
  autoSnapshot,
  onHousingChange,
  onFocusSelected,
  orderedSlots,
  onReorder,
  source = "leads",
  onAutoToggleReady,
  invalidateKeys: invalidateKeysProp,
}: {
  lead: Lead;
  housing: HousingStatus;
  autoSnapshot?: Record<string, unknown> | null;
  onHousingChange: (next: HousingStatus) => void;
  onFocusSelected?: (opt: "homeowner" | "renter") => void;
  orderedSlots: string[];
  onReorder: (next: string[]) => void;
  source?: "leads" | "list_leads";
  onAutoToggleReady?: (toggle: (next: boolean) => void) => void;
  invalidateKeys?: readonly unknown[][];
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const currentUserId = user?.id ?? "";
  // Vendor payloads come in mixed casing ("Auto", "HOME", "Both"); normalize
  // before checking so we don't accidentally hide both Auto and Home panes —
  // that would leave the agent with no dispo selector to set.
  const lt: string[] = (Array.isArray(lead.lead_types) ? lead.lead_types : []).map((s) => String(s).toLowerCase());
  const hasHomeLine = lt.length === 0 ? true : lt.includes("home") || lt.includes("both");
  // Auto pane is always available so agents can cross-sell auto on every lead.
  const hasAuto = true;
  const invalidateKeys: readonly unknown[][] =
    invalidateKeysProp && invalidateKeysProp.length > 0 ? invalidateKeysProp : [[source]];
  const [confirmOffOpen, setConfirmOffOpen] = useState(false);
  const hasAutoArchive = !!(lead as unknown as { auto_archive?: unknown }).auto_archive;

  const AUTO_FIELDS = [
    "current_carrier",
    "num_vehicles",
    "vehicles",
    "dispo",
    "claimed_by",
    "claimed_at",
    "quoted_premium",
    "agent_notes",
    "follow_up_at",
    "x_date",
    "auto_sale_type",
    "auto_motor_club_premium",
    "auto_policies_count",
  ] as const;
  const hasMeaningfulAutoData = (data: Record<string, unknown> | null | undefined) => {
    if (!data) return false;
    return AUTO_FIELDS.some((field) => {
      const value = data[field];
      if (value == null) return false;
      if (field === "vehicles") return !Array.isArray(value) || value.length > 0;
      if (typeof value === "string") return value.trim().length > 0;
      if (typeof value === "number") return value > 0;
      return true;
    });
  };

  const setAutoEnabled = async (enabled: boolean) => {
    const next = enabled ? (hasHomeLine ? ["auto", "home"] : ["auto"]) : hasHomeLine ? ["home"] : [];

    const update: Record<string, unknown> = { lead_types: next };
    const leadAny = lead as unknown as Record<string, unknown>;
    const existingArchive = (leadAny.auto_archive ?? null) as Record<string, unknown> | null;
    const canRestoreArchive = hasMeaningfulAutoData(existingArchive);

    if (!enabled) {
      // Snapshot current auto-side fields, then clear them.
      const snapshot: Record<string, unknown> = {};
      for (const f of AUTO_FIELDS) snapshot[f] = autoSnapshot?.[f] ?? leadAny[f] ?? null;
      const archiveSource = hasMeaningfulAutoData(snapshot) ? snapshot : existingArchive;
      if (archiveSource) {
        update.auto_archive = { ...archiveSource, archived_at: new Date().toISOString() };
      }
      update.current_carrier = null;
      update.num_vehicles = 0;
      update.vehicles = [];
      update.dispo = null;
      update.claimed_by = null;
      update.claimed_at = null;
      update.quoted_premium = null;
      update.agent_notes = null;
      update.follow_up_at = null;
      update.x_date = null;
      update.auto_sale_type = null;
      update.auto_motor_club_premium = null;
      update.auto_policies_count = 0;
    } else if (hasAutoArchive && canRestoreArchive) {
      // Restore from archive.
      const archive = existingArchive ?? {};
      for (const f of AUTO_FIELDS) {
        if (f in archive) update[f] = archive[f];
      }
      update.auto_archive = null;
    }

    qc.setQueriesData<Lead[]>({ queryKey: [source] }, (old) => {
      if (!Array.isArray(old)) return old as any;
      return old.map((l) => (l.id === lead.id ? { ...l, ...(update as Partial<Lead>) } : l));
    });
    const { error } = await (supabase.from(source) as any).update(update).eq("id", lead.id);
    if (error) {
      toast.error(error.message);
    } else if (!enabled) {
      toast.success("Auto turned off — info archived. Toggle Auto back on to restore.");
    } else if (hasAutoArchive && canRestoreArchive) {
      toast.success("Auto restored from archive.");
    } else if (enabled && hasAutoArchive) {
      toast.error("No archived Auto info was available to restore.");
    }
    for (const k of invalidateKeys) qc.invalidateQueries({ queryKey: k });
  };

  useEffect(() => {
    onAutoToggleReady?.((next: boolean) => {
      if (!next) setConfirmOffOpen(true);
      else void setAutoEnabled(true);
    });
  }, [onAutoToggleReady, hasAuto, hasHomeLine, hasAutoArchive]);

  const { lines: panelLines, addLine, removeLine } = useLeadLines(lead.id, source, invalidateKeys);
  const activeTypes = new Set(panelLines.map((l) => l.type));

  const renderAddAnotherButton = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Add another ${label}`}
      className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border/50 bg-transparent py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition hover:border-cyan-400/60 hover:bg-cyan-500/5 hover:text-cyan-200"
    >
      <Plus className="h-3.5 w-3.5" />
      Add another {label}
    </button>
  );

  const renderAutoCard = () => (
    <div
      className={`flex w-full items-center gap-4 rounded-xl border p-3.5 transition-all duration-300 ${
        hasAuto
          ? "border-cyan-400/70 bg-cyan-500/15 shadow-[0_0_20px_rgba(6,182,212,0.25)] shadow-cyan-500/20"
          : "border-border/40 bg-muted/10 opacity-60 hover:opacity-80 hover:border-border/60"
      }`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition ${
          hasAuto
            ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.35)]"
            : "border-border/50 bg-muted/30 text-muted-foreground/60"
        }`}
      >
        <Car className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold transition ${hasAuto ? "text-cyan-100" : "text-muted-foreground/70"}`}>
          Auto
        </div>
      </div>
      <Switch
        checked={hasAuto}
        onCheckedChange={(c: boolean) => {
          if (!c) setConfirmOffOpen(true);
          else void setAutoEnabled(true);
        }}
        aria-label={`${hasAuto ? "Remove" : "Add"} Auto`}
        className={hasAuto ? "data-[state=checked]:bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.4)]" : ""}
      />
    </div>
  );

  const renderCrossSellCard = (
    type: LineType,
    label: string,
    Icon: typeof Car,
    active: boolean,
    onToggleCard: (next: boolean) => void,
    count?: number,
  ) => (
    <div
      className={`group flex w-full items-center gap-4 rounded-xl border p-3.5 transition-all duration-300 ${
        active
          ? "border-cyan-400/70 bg-cyan-500/15 shadow-[0_0_20px_rgba(6,182,212,0.25)] shadow-cyan-500/20"
          : "border-border/40 bg-muted/10 opacity-60 hover:opacity-80 hover:border-border/60"
      }`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition ${
          active
            ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.35)]"
            : "border-border/50 bg-muted/30 text-muted-foreground/60"
        }`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={`flex items-center gap-1.5 text-sm font-semibold transition ${active ? "text-cyan-100" : "text-muted-foreground/70"}`}
        >
          <span>{label}</span>
          {count && count > 1 ? (
            <span className="rounded-full border border-cyan-400/50 bg-cyan-500/20 px-1.5 py-0 text-[10px] font-semibold leading-4 text-cyan-100">
              ×{count}
            </span>
          ) : null}
        </div>
      </div>
      <Switch
        checked={active}
        onCheckedChange={onToggleCard}
        aria-label={`${active ? "Remove" : "Add"} ${label}`}
        className={active ? "data-[state=checked]:bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.4)]" : ""}
      />
    </div>
  );

  const slots: LobSlot[] = orderedSlots.flatMap((key): LobSlot[] => {
    if (key === "auto") {
      const hasExtraAutoNext = panelLines.some((l) => l.type === "auto");
      return [
        {
          key,
          render: () => (
            <>
              {renderAutoCard()}
              {hasAuto && !hasExtraAutoNext && renderAddAnotherButton("Auto", () => addLine("auto"))}
            </>
          ),
        },
      ];
    }
    if (key === "home") {
      const active = housing === "homeowner";
      const hasExtraHomeNext = panelLines.some((l) => l.type === "home");
      return [
        {
          key,
          render: () => (
            <>
              {renderCrossSellCard("home" as unknown as LineType, "Home", HomeIcon, active, (next) => {
                onHousingChange(next ? "homeowner" : null);
              })}
              {active && !hasExtraHomeNext && renderAddAnotherButton("Home", () => addLine("home"))}
            </>
          ),
        },
      ];
    }
    if (key === "renter") {
      const active = housing === "renter";
      return [
        {
          key,
          render: () =>
            renderCrossSellCard("renter" as unknown as LineType, "Renters", Key, active, (next) => {
              onHousingChange(next ? "renter" : null);
            }),
        },
      ];
    }
    if (key.startsWith("line:")) {
      const lineId = key.slice(5);
      const line = panelLines.find((l) => l.line_id === lineId);
      if (!line) return [];
      const csMeta = CROSS_SELL_LINES.find((c) => c.type === line.type);
      const label = csMeta?.label ?? LINE_TYPE_META[line.type]?.label ?? line.type;
      const Icon = csMeta?.Icon ?? EXTRA_LINE_ICONS[line.type] ?? Umbrella;
      const typeCount = panelLines.filter((l) => l.type === line.type).length;
      const lastIdOfType = panelLines
        .filter((l) => l.type === line.type)
        .map((l) => l.line_id)
        .slice(-1)[0];
      const isLastOfType = line.line_id === lastIdOfType;
      return [
        {
          key,
          render: () => (
            <>
              {renderCrossSellCard(
                line.type,
                label,
                Icon,
                true,
                (next) => {
                  if (!next) removeLine(line.line_id);
                },
                typeCount,
              )}
              {isLastOfType && (
                <button
                  type="button"
                  onClick={() => addLine(line.type)}
                  aria-label={`Add another ${label}`}
                  className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border/50 bg-transparent py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition hover:border-cyan-400/60 hover:bg-cyan-500/5 hover:text-cyan-200"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add another {label}
                </button>
              )}
            </>
          ),
        },
      ];
    }
    return [];
  });

  const inactiveCrossSell = CROSS_SELL_LINES.filter((c) => !activeTypes.has(c.type));

  return (
    <div className="space-y-4">
      <LobReorderable slots={slots} onReorder={onReorder} />
      {inactiveCrossSell.length > 0 && (
        <div className="space-y-2 pt-1">
          {inactiveCrossSell.map((c) => (
            <div key={c.type}>
              {renderCrossSellCard(c.type, c.label, c.Icon, false, (next) => {
                if (next) addLine(c.type);
              })}
            </div>
          ))}
        </div>
      )}
      <AlertDialog open={confirmOffOpen} onOpenChange={setConfirmOffOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn Auto off?</AlertDialogTitle>
            <AlertDialogDescription>
              All Auto info on this lead — carrier, vehicles, dispo, quoted premium, follow-ups, agent notes, and sale
              data — will be cleared from the active record and saved to an archive. Turn Auto back on to restore
              everything.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOffOpen(false);
                void setAutoEnabled(false);
              }}
            >
              Turn off & archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Left-column Home/Renter section. Mirrors the Auto section's UI:
 * big header + carrier select, property details grid (homeowner only),
 * then the LeadSidePane for premium / dispo / notes (home_* columns).
 * Only appears when housing_status is set via the right-column toggle.
 */
function DashboardHomeSection({
  lead,
  housingOverride,
  source = "leads",
  onTurnOff,
  invalidateKeys,
}: {
  lead: Lead;
  housingOverride?: HousingStatus;
  source?: "leads" | "list_leads";
  onTurnOff?: () => void;
  invalidateKeys?: readonly unknown[][];
}) {
  const housing = housingOverride ?? (lead.housing_status as HousingStatus) ?? null;
  const qc = useQueryClient();
  const invKeys: readonly unknown[][] = invalidateKeys && invalidateKeys.length > 0 ? invalidateKeys : [[source]];
  const { user } = useAuth();
  const currentUserId = user?.id ?? "";
  const isAdmin = useHasRole("admin");
  const isVendor = useHasRole("vendor");
  const homeClaimedByOther = !!lead.home_claimed_by && lead.home_claimed_by !== currentUserId;
  const cachedAgents =
    qc.getQueryData<Array<{ id: string; full_name: string | null; email: string; avatar_url?: string | null }>>([
      "sales-agents",
    ]) ?? [];

  const [carrier, setCarrier] = useState(lead.current_home_carrier ?? "");
  const [yearBuilt, setYearBuilt] = useState(lead.year_built != null ? String(lead.year_built) : "");
  const [sqft, setSqft] = useState(lead.square_feet != null ? String(lead.square_feet) : "");
  const [bedrooms, setBedrooms] = useState(lead.num_bedrooms != null ? String(lead.num_bedrooms) : "");
  const [bathrooms, setBathrooms] = useState(lead.num_bathrooms != null ? String(lead.num_bathrooms) : "");
  const [stories, setStories] = useState(lead.num_stories != null ? String(lead.num_stories) : "");
  const [construction, setConstruction] = useState(lead.construction_type ?? "");
  const [roofType, setRoofType] = useState(lead.roof_type ?? "");
  const [roofYear, setRoofYear] = useState(lead.roof_year != null ? String(lead.roof_year) : "");
  const [dwelling, setDwelling] = useState(lead.dwelling_value != null ? String(lead.dwelling_value) : "");
  const [claims, setClaims] = useState(lead.claims_last_5y != null ? String(lead.claims_last_5y) : "");
  const [mortgage, setMortgage] = useState(lead.mortgage_company ?? "");
  const [hasPool, setHasPool] = useState(!!lead.has_pool);
  const [hasTrampoline, setHasTrampoline] = useState(!!lead.has_trampoline);
  const [homeQuoted, setHomeQuoted] = useState(
    lead.home_quoted_premium != null ? String(lead.home_quoted_premium) : "",
  );

  useEffect(() => {
    setCarrier(lead.current_home_carrier ?? "");
    setYearBuilt(lead.year_built != null ? String(lead.year_built) : "");
    setSqft(lead.square_feet != null ? String(lead.square_feet) : "");
    setBedrooms(lead.num_bedrooms != null ? String(lead.num_bedrooms) : "");
    setBathrooms(lead.num_bathrooms != null ? String(lead.num_bathrooms) : "");
    setStories(lead.num_stories != null ? String(lead.num_stories) : "");
    setConstruction(lead.construction_type ?? "");
    setRoofType(lead.roof_type ?? "");
    setRoofYear(lead.roof_year != null ? String(lead.roof_year) : "");
    setDwelling(lead.dwelling_value != null ? String(lead.dwelling_value) : "");
    setClaims(lead.claims_last_5y != null ? String(lead.claims_last_5y) : "");
    setMortgage(lead.mortgage_company ?? "");
    setHasPool(!!lead.has_pool);
    setHasTrampoline(!!lead.has_trampoline);
    setHomeQuoted(lead.home_quoted_premium != null ? String(lead.home_quoted_premium) : "");
  }, [lead.id]);

  // Home-side dispo gating dialogs — mirror the Auto pill row in the parent
  // dialog. Without these, the close-guard correctly blocks closing the lead
  // with "Home: add dispo" but the agent has no UI to actually set one.
  const homeDispo = (lead.home_dispo as Dispo | null) ?? null;
  const [pendingHomeFollowUp, setPendingHomeFollowUp] = useState(false);
  const [pendingHomeFollowUpAt, setPendingHomeFollowUpAt] = useState("");
  const [pendingHomeXDate, setPendingHomeXDate] = useState(false);
  const [pendingHomeXDateAt, setPendingHomeXDateAt] = useState("");
  const [pendingHomeSale, setPendingHomeSale] = useState(false);
  const [pendingHomePremium, setPendingHomePremium] = useState<{ next: Dispo } | null>(null);
  const [pendingHomePremiumAmt, setPendingHomePremiumAmt] = useState("");
  const [confirmHomeReleaseSold, setConfirmHomeReleaseSold] = useState(false);
  const [confirmHomeReleaseScheduled, setConfirmHomeReleaseScheduled] = useState<null | "follow_up" | "x_date">(null);

  const persistHomeDispo = async (patch: Record<string, unknown>) => {
    const full: Record<string, unknown> = { ...patch };
    if (!lead.home_claimed_by && currentUserId && patch.home_dispo) {
      full.home_claimed_by = currentUserId;
      full.home_claimed_at = new Date().toISOString();
    }
    await saveField(full);
  };

  const handleHomeDispoPick = (value: Dispo) => {
    const active = homeDispo === value;
    if (active) {
      if (value === "sold") {
        setConfirmHomeReleaseSold(true);
        return;
      }
      if (value === "follow_up" || value === "x_date") {
        setConfirmHomeReleaseScheduled(value);
        return;
      }
      void persistHomeDispo({
        home_dispo: null,
        home_follow_up_at: null,
        home_x_date: null,
      });
      return;
    }
    if (value === "sold") {
      setPendingHomeSale(true);
      return;
    }
    if (value === "follow_up") {
      setPendingHomeFollowUpAt(lead.home_follow_up_at ? lead.home_follow_up_at.slice(0, 16) : "");
      setPendingHomeFollowUp(true);
      return;
    }
    if (value === "x_date") {
      setPendingHomeXDateAt(lead.home_x_date ?? "");
      setPendingHomeXDate(true);
      return;
    }
    if (dispoRequiresPremium(value)) {
      const n = homeQuoted ? Number(homeQuoted) : NaN;
      if (!Number.isFinite(n) || n <= 0) {
        setPendingHomePremiumAmt(homeQuoted || "");
        setPendingHomePremium({ next: value });
        return;
      }
    }
    void persistHomeDispo({
      home_dispo: value,
      home_follow_up_at: null,
      home_x_date: null,
    });
  };

  const saveField = async (patch: Record<string, unknown>) => {
    const { error } = await (supabase.from(source) as any).update(patch).eq("id", lead.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    for (const k of invKeys) qc.invalidateQueries({ queryKey: k });
  };

  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  if (!housing) return null;

  const isHomeowner = housing === "homeowner";
  const sideLabel = isHomeowner ? "Home" : "Renters";
  const brand = getCarrierBrand(carrier);

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
    <div id={`dashboard-home-section-${lead.id}`} className="scroll-mt-4 space-y-8 pt-4 border-t border-border/60">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-5xl font-bold tracking-tight text-foreground">{sideLabel}</h2>
          <Select
            value={carrier || undefined}
            onValueChange={(v) => {
              setCarrier(v);
              void saveField({ current_home_carrier: v });
            }}
          >
            <SelectTrigger
              className="inline-flex h-8 w-fit items-center gap-2 rounded-full border px-4 text-sm font-semibold tracking-wide transition-colors hover:opacity-90 focus:ring-0 focus:ring-offset-0 [&>svg]:hidden"
              style={{ borderColor: brand.border, backgroundColor: brand.bg, color: brand.text }}
            >
              <SelectValue placeholder="Set carrier" />
            </SelectTrigger>
            <SelectContent className="max-h-80 rounded-2xl border-border/60 bg-popover/80 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl">
              {HOME_CARRIERS.map((c) => {
                const b = getCarrierBrand(c);
                return (
                  <SelectItem
                    key={c}
                    value={c}
                    className="group my-0.5 rounded-xl px-2.5 py-2 text-sm font-medium tracking-tight transition-colors focus:bg-muted/60 data-[state=checked]:bg-muted/40 data-[state=checked]:font-semibold"
                  >
                    <span className="inline-flex items-center gap-2.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full ring-2 ring-transparent transition-all group-hover:ring-white/10"
                        style={{ backgroundColor: b.dot }}
                      />
                      <span>{c}</span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3">
          {!isVendor && !lead.home_claimed_by && currentUserId && (
            <Button
              size="sm"
              onClick={async () => {
                await saveField({ home_claimed_by: currentUserId, home_claimed_at: new Date().toISOString() });
                toast.success("Home claimed");
              }}
              className="h-8 rounded-full bg-emerald-500 px-4 text-sm font-semibold text-white shadow-[0_0_10px_rgba(16,185,129,0.4)] hover:bg-emerald-400"
            >
              Unclaimed — Claim Home
            </Button>
          )}
          {!isVendor && lead.home_claimed_by === currentUserId && (
            <span className="inline-flex h-7 items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-300">
              Claimed by you
            </span>
          )}
          <LineOwnerControl
            leadId={lead.id}
            leadTable={source}
            lineId="home"
            claimedBy={lead.home_claimed_by ?? null}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            agents={cachedAgents}
            disabled={homeClaimedByOther && !isAdmin}
            onToggleClaim={(next) => {
              if (next && currentUserId) {
                void saveField({ home_claimed_by: currentUserId, home_claimed_at: new Date().toISOString() });
              } else {
                void saveField({ home_claimed_by: null, home_claimed_at: null });
              }
            }}
            onReassign={(agentId) => {
              void saveField({
                home_claimed_by: agentId,
                home_claimed_at: agentId ? new Date().toISOString() : null,
              });
            }}
          />
          <Switch
            id={`home-on-${lead.id}`}
            checked={true}
            onCheckedChange={(c) => {
              if (!c) onTurnOff?.();
            }}
            aria-label={`Turn off ${sideLabel}`}
            className="data-[state=checked]:bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.4)]"
          />
        </div>
      </div>

      {isHomeowner && (
        <>
          <PropertyLookupLinks
            street={lead.street}
            city={lead.city}
            state={lead.state}
            zip={lead.zip}
            county={lead.county}
          />
          <ZillowPropertyCard leadId={lead.id} hasAddress={!!lead.street && !!lead.zip} />
          <section className="space-y-3">
            <SectionLabel>Property Details</SectionLabel>
            <div className="rounded-2xl border border-border/60 bg-background/40 backdrop-blur-md p-4 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <FieldNumber
                  label="Year built"
                  value={yearBuilt}
                  onChange={setYearBuilt}
                  onBlur={() => saveField({ year_built: num(yearBuilt) })}
                />
                <FieldNumber
                  label="Square feet"
                  value={sqft}
                  onChange={setSqft}
                  onBlur={() => saveField({ square_feet: num(sqft) })}
                />
                <FieldNumber
                  label="Dwelling value ($)"
                  value={dwelling}
                  onChange={setDwelling}
                  onBlur={() => saveField({ dwelling_value: num(dwelling) })}
                />
                <FieldNumber
                  label="Bedrooms"
                  value={bedrooms}
                  onChange={setBedrooms}
                  onBlur={() => saveField({ num_bedrooms: num(bedrooms) })}
                />
                <FieldNumber
                  label="Bathrooms"
                  value={bathrooms}
                  onChange={setBathrooms}
                  onBlur={() => saveField({ num_bathrooms: num(bathrooms) })}
                />
                <FieldNumber
                  label="Stories"
                  value={stories}
                  onChange={setStories}
                  onBlur={() => saveField({ num_stories: num(stories) })}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <FieldSelect
                  label="Construction"
                  value={construction}
                  options={CONSTRUCTION_TYPES}
                  onChange={(v) => {
                    setConstruction(v);
                    void saveField({ construction_type: v });
                  }}
                />
                <FieldSelect
                  label="Roof type"
                  value={roofType}
                  options={ROOF_TYPES}
                  onChange={(v) => {
                    setRoofType(v);
                    void saveField({ roof_type: v });
                  }}
                />
                <FieldNumber
                  label="Year roof replaced"
                  value={roofYear}
                  onChange={setRoofYear}
                  onBlur={() => saveField({ roof_year: num(roofYear) })}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <FieldNumber
                  label="Claims (last 5y)"
                  value={claims}
                  onChange={setClaims}
                  onBlur={() => saveField({ claims_last_5y: num(claims) })}
                />
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
                    Mortgage company
                  </Label>
                  <Input
                    value={mortgage}
                    onChange={(e) => setMortgage(e.target.value)}
                    onBlur={() => saveField({ mortgage_company: mortgage.trim() || null })}
                    placeholder="Optional"
                    className="h-10 rounded-lg bg-background/60"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-6 pt-1">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={hasPool}
                    onCheckedChange={(c) => {
                      const v = !!c;
                      setHasPool(v);
                      void saveField({ has_pool: v });
                    }}
                  />
                  <span>Has pool</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={hasTrampoline}
                    onCheckedChange={(c) => {
                      const v = !!c;
                      setHasTrampoline(v);
                      void saveField({ has_trampoline: v });
                    }}
                  />
                  <span>Has trampoline</span>
                </label>
              </div>
            </div>
          </section>
        </>
      )}

      <section>
        <div className="relative flex items-center gap-4 rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-card/40 to-cyan-500/[0.04] px-4 py-3 backdrop-blur-md">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10">
            <HomeIcon className="h-5 w-5 text-cyan-400" />
          </div>
          <div className="flex-1 text-center">
            <div className="text-[11px] font-medium uppercase tracking-wider text-cyan-400">Quoted Premium</div>
            <div className="mt-0.5 flex items-baseline justify-center gap-0.5 text-2xl font-bold text-cyan-400">
              <span className="text-cyan-400/70">$</span>
              <Input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={homeQuoted}
                onChange={(e) => setHomeQuoted(e.target.value)}
                onBlur={() => saveField({ home_quoted_premium: num(homeQuoted) })}
                placeholder="0.00"
                className="h-auto w-28 border-0 bg-transparent p-0 text-center font-bold text-2xl tabular-nums tracking-tight text-cyan-400 shadow-none placeholder:text-cyan-400/30 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
          </div>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-cyan-500/20 bg-cyan-500/10">
            <ShieldCheck className="h-5 w-5 text-cyan-400" />
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <SectionLabel accent="cyan">Agent notes</SectionLabel>
        <LeadNotesThread leadTable={source} leadId={lead.id} lineKey="home" />
      </section>

      <section className="space-y-3">
        <SectionLabel accent="amber">Disposition</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {DISPO_OPTIONS.map((d) => {
            const active = homeDispo === d.value;
            const activeCls = "border-cyan-500/70 bg-transparent text-cyan-400";
            return (
              <button
                key={d.value}
                type="button"
                onClick={() => handleHomeDispoPick(d.value as Dispo)}
                className={`group relative h-8 rounded-full border px-3 text-xs font-medium tracking-wide transition-all ${
                  active
                    ? activeCls
                    : "border-border/60 bg-transparent text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
        {homeDispo === "follow_up" && lead.home_follow_up_at && (
          <p className="text-[11px] text-amber-400/80">
            Follow-up scheduled for{" "}
            {new Date(lead.home_follow_up_at).toLocaleString([], {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            <button
              type="button"
              onClick={() => {
                setPendingHomeFollowUpAt(lead.home_follow_up_at!.slice(0, 16));
                setPendingHomeFollowUp(true);
              }}
              className="ml-2 underline hover:text-amber-300"
            >
              change
            </button>
          </p>
        )}
        {homeDispo === "x_date" && lead.home_x_date && (
          <p className="text-[11px] text-violet-400/80">
            X-date set for{" "}
            {new Date(lead.home_x_date + "T00:00:00").toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
            <button
              type="button"
              onClick={() => {
                setPendingHomeXDateAt(lead.home_x_date ?? "");
                setPendingHomeXDate(true);
              }}
              className="ml-2 underline hover:text-violet-300"
            >
              change
            </button>
          </p>
        )}
      </section>

      <AlertDialog open={pendingHomeFollowUp} onOpenChange={(o) => !o && setPendingHomeFollowUp(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set Home follow-up date & time</AlertDialogTitle>
            <AlertDialogDescription>
              A follow-up disposition requires a scheduled date and time so this lead lands on your follow-ups queue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1 py-2">
            <Label className="text-xs">Follow-up at</Label>
            <Input
              type="datetime-local"
              value={pendingHomeFollowUpAt}
              onChange={(e) => setPendingHomeFollowUpAt(e.target.value)}
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!pendingHomeFollowUpAt}
              onClick={(e) => {
                e.preventDefault();
                if (!pendingHomeFollowUpAt) return;
                const iso = new Date(pendingHomeFollowUpAt).toISOString();
                setPendingHomeFollowUp(false);
                void persistHomeDispo({
                  home_dispo: "follow_up",
                  home_follow_up_at: iso,
                  home_x_date: null,
                });
              }}
            >
              Save follow-up
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingHomeXDate} onOpenChange={(o) => !o && setPendingHomeXDate(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set Home X-date</AlertDialogTitle>
            <AlertDialogDescription>
              X-date requires a renewal date so the lead reappears in your queue when it's time to re-quote.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1 py-2">
            <Label className="text-xs">Renewal / X-date</Label>
            <Input
              type="date"
              value={pendingHomeXDateAt}
              onChange={(e) => setPendingHomeXDateAt(e.target.value)}
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!pendingHomeXDateAt}
              onClick={(e) => {
                e.preventDefault();
                if (!pendingHomeXDateAt) return;
                setPendingHomeXDate(false);
                void persistHomeDispo({
                  home_dispo: "x_date",
                  home_x_date: pendingHomeXDateAt,
                  home_follow_up_at: null,
                });
              }}
            >
              Save X-date
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingHomePremium} onOpenChange={(o) => !o && setPendingHomePremium(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enter Home quoted premium</AlertDialogTitle>
            <AlertDialogDescription>
              This disposition implies a quote was given. Enter the quoted premium to continue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1 py-2">
            <Label className="text-xs">Quoted premium ($)</Label>
            <Input
              type="number"
              step="0.01"
              inputMode="decimal"
              value={pendingHomePremiumAmt}
              onChange={(e) => setPendingHomePremiumAmt(e.target.value)}
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!pendingHomePremiumAmt || !(Number(pendingHomePremiumAmt) > 0)}
              onClick={(e) => {
                e.preventDefault();
                const n = Number(pendingHomePremiumAmt);
                if (!Number.isFinite(n) || n <= 0) return;
                const next = pendingHomePremium?.next;
                setPendingHomePremium(null);
                setHomeQuoted(String(n));
                if (!next) return;
                void persistHomeDispo({
                  home_dispo: next,
                  home_quoted_premium: n,
                  home_follow_up_at: null,
                  home_x_date: null,
                });
              }}
            >
              Save & continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmHomeReleaseSold} onOpenChange={(o) => !o && setConfirmHomeReleaseSold(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release Home sale?</AlertDialogTitle>
            <AlertDialogDescription>
              This Home line is marked Sold. Clearing it removes the sale from commission totals and leaderboards. Are
              you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmHomeReleaseSold(false);
                void persistHomeDispo({
                  home_dispo: null,
                  home_sale_type: null,
                  home_follow_up_at: null,
                  home_x_date: null,
                });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, clear sale
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmHomeReleaseScheduled !== null}
        onOpenChange={(o) => !o && setConfirmHomeReleaseScheduled(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Clear Home {confirmHomeReleaseScheduled === "x_date" ? "X-date" : "follow-up"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the scheduled {confirmHomeReleaseScheduled === "x_date" ? "renewal date" : "follow-up"} from
              your calendar. The dispo will be cleared.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmHomeReleaseScheduled(null);
                void persistHomeDispo({
                  home_dispo: null,
                  home_follow_up_at: null,
                  home_x_date: null,
                });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear & remove date
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SaleTypeDialog
        open={pendingHomeSale}
        side="home"
        defaultValue={(lead as unknown as { home_sale_type?: SaleType | null }).home_sale_type ?? null}
        premium={homeQuoted.trim() === "" ? (lead.home_quoted_premium ?? null) : Number(homeQuoted)}
        leadName={`${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || null}
        onCancel={() => setPendingHomeSale(false)}
        onConfirm={async ({ saleType, premium: confirmedPremium }) => {
          setPendingHomeSale(false);
          setHomeQuoted(String(confirmedPremium));
          await persistHomeDispo({
            home_dispo: "sold",
            home_sale_type: saleType,
            home_quoted_premium: confirmedPremium,
            home_follow_up_at: null,
            home_x_date: null,
          });
          toast.success("Home sale confirmed");
        }}
      />
    </div>
  );
}

function PropertyLookupLinks({
  street,
  city,
  state,
  zip,
  county,
}: {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  county?: string | null;
}) {
  const addressLine = [street, city, state, zip].filter((p) => p && String(p).trim()).join(", ");
  if (!addressLine) return null;
  const zillowUrl = `https://www.zillow.com/homes/${encodeURIComponent(addressLine)}_rb/`;
  const assessorResult = getCountyAssessorSearchUrl(state, county, { street, city, zip });
  const assessorQuery =
    county && county.trim()
      ? `${county} County ${state ?? ""} property appraiser ${addressLine}`
      : `${state ?? ""} county property appraiser ${addressLine}`;
  const assessorUrl = assessorResult?.url ?? `https://duckduckgo.com/?q=${encodeURIComponent(assessorQuery)}`;
  const countyPrefix = county && county.trim() ? `${county} County ` : "";
  const assessorLabel = assessorResult
    ? assessorResult.preloaded
      ? `${countyPrefix}Property Appraiser`
      : `${countyPrefix}Property Appraiser (search)`
    : `${countyPrefix || "County "}Assessor (search)`;
  return (
    <section className="space-y-3">
      <SectionLabel>Property Research</SectionLabel>
      <div className="flex flex-wrap gap-2">
        <a
          href={zillowUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300 transition-colors hover:border-cyan-400 hover:bg-cyan-500/20"
        >
          <HomeIcon className="h-4 w-4" />
          Zillow
        </a>
        <a
          href={assessorUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-300 transition-colors hover:border-amber-400 hover:bg-amber-500/20"
        >
          <FileText className="h-4 w-4" />
          {assessorLabel}
        </a>
      </div>
    </section>
  );
}

function FieldNumber({
  label,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="h-10 rounded-lg bg-background/60"
      />
    </div>
  );
}

function FieldSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">{label}</Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className="h-10 rounded-lg bg-background/60">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
