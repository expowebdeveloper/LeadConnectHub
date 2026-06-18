import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useHasRole } from "@/lib/auth";
import { AppShell, PageHeader, HeroTitle } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DISPO_OPTIONS, type Dispo, SCRIPT_TYPES, type ScriptType } from "@/lib/constants";
import { VEHICLE_YEARS, VEHICLE_MAKES, VEHICLE_MODELS_BY_MAKE, type Vehicle } from "@/lib/constants";
import { Shield, Phone, Plus, X, CalendarDays, LayoutGrid, List as ListIcon, Mail, MessageSquare, ClipboardCheck, Pencil } from "lucide-react";
import { Inbox, Fish, Target } from "lucide-react";
import { EmptyCTA } from "@/components/EmptyCTA";
import { format, startOfDay } from "date-fns";
import { toast } from "sonner";
import { LeadActivityList } from "@/components/LeadActivityList";
import { CallButton } from "@/components/CallButton";
import { LeadScoreChip } from "@/components/LeadScoreChip";
import { EmailLeadButton } from "@/components/EmailLeadButton";
import { TextLeadButton } from "@/components/TextLeadButton";
import { PhoneLink } from "@/components/PhoneLink";
import { LeadShareSection } from "@/components/LeadShareSection";
import { LeadSideDispoPanel, type SideState, type HousingStatus } from "@/components/LeadSideDispo";
import { LeadExtraLines } from "@/components/LeadExtraLines";
import { SaleTypeDialog, type SaleType } from "@/components/SaleTypeDialog";
import { useServerFn } from "@tanstack/react-start";
import { listSalesAgents, lookupVendorNames } from "@/lib/admin.functions";
import { Users2 } from "lucide-react";
import { EditLeadDialog as LeadWorkspaceDialog } from "@/routes/liveleads";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

export const Route = createFileRoute("/my-leads")({
  head: () => ({
    meta: [
      { title: "My Leads — LeadVault" },
      { name: "description", content: "Your board of leads and follow-ups." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    openLead: typeof s.openLead === "string" ? s.openLead : undefined,
  }),
  component: MyLeadsPage,
});

type BoardLead = {
  id: string;
  source: "leads" | "list_leads";
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  current_carrier: string | null;
  num_vehicles: number | null;
  dispo: Dispo | null;
  quoted_premium: number | null;
  follow_up_at: string | null;
  list_type: string | null;
  claimed_at: string | null;
  created_at: string;
  claimed_by: string | null;
  agent_notes: string | null;
  lead_type: string | null;
  vendor_id: string | null;
  is_shared?: boolean;
  housing_status: "homeowner" | "renter" | null;
  composite_score?: number | null;
  score_tier?: "S" | "A" | "B" | "C" | null;
  auto_sale_type?: SaleType | null;
  home_sale_type?: SaleType | null;
  home_dispo?: Dispo | null;
  home_quoted_premium?: number | null;
  home_claimed_by?: string | null;
  auto_policies_count?: number | null;
  home_policies_count?: number | null;
  auto_motor_club_premium?: number | null;
};

type FullLead = {
  id: string;
  source: "leads" | "list_leads";
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  date_of_birth: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  current_carrier: string | null;
  num_vehicles: number;
  vehicles: Vehicle[];
  vendor_notes: string | null;
  dispo: Dispo | null;
  quoted_premium: number | null;
  current_premium: number | null;
  agent_notes: string | null;
  follow_up_at: string | null;
  x_date: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
  vendor_id: string | null;
  list_type: string | null;
  housing_status: "homeowner" | "renter" | null;
  auto_policies_count: number | null;
  home_policies_count: number | null;
  home_dispo: Dispo | null;
  home_claimed_by: string | null;
  home_claimed_at: string | null;
  home_quoted_premium: number | null;
  home_follow_up_at: string | null;
  home_x_date: string | null;
  home_agent_notes: string | null;
  lead_types?: string[] | null;
  lead_lines?: unknown;
};

type LeadLineLite = {
  type?: string | null;
  dispo?: string | null;
  claimed_by?: string | null;
};

function leadLinesArray(lead: BoardLead): LeadLineLite[] {
  const raw = (lead as BoardLead & { lead_lines?: unknown }).lead_lines;
  return Array.isArray(raw) ? (raw as LeadLineLite[]) : [];
}

function soldExtraLineTypes(lead: BoardLead): string[] {
  return leadLinesArray(lead)
    .filter((l) => String(l?.dispo ?? "").toLowerCase() === "sold")
    .map((l) => String(l?.type ?? "").toLowerCase())
    .filter(Boolean);
}

function hasSoldExtraLine(lead: BoardLead): boolean {
  return soldExtraLineTypes(lead).length > 0;
}
function formatListType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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

function leadTypeBadgeProps(type: string | null | undefined): { label: string; className: string } | null {
  switch (type) {
    case "auto":
      return { label: "Auto", className: "bg-blue-100 text-blue-900 border-blue-200" };
    case "home":
      return { label: "Home", className: "bg-orange-100 text-orange-900 border-orange-200" };
    case "both":
      return { label: "Home + Auto", className: "bg-purple-100 text-purple-900 border-purple-200" };
    default:
      return null;
  }
}

function housingStatusBadgeProps(status: "homeowner" | "renter" | null): { label: string; className: string } | null {
  switch (status) {
    case "homeowner":
      return { label: "Homeowner", className: "bg-emerald-100 text-emerald-900 border-emerald-200" };
    case "renter":
      return { label: "Renter", className: "bg-teal-100 text-teal-900 border-teal-200" };
    default:
      return null;
  }
}


type ColumnDef = {
  key: Dispo | "none";
  label: string;
  accent: string; // top-border accent color
  dot: string;    // small dot/text color for badge
  emptyTitle: string;
  emptyHint: string;
};

const COLUMNS: ColumnDef[] = [
  {
    key: "none",
    label: "Claimed",
    accent: "border-t-slate-500/60",
    dot: "text-slate-400",
    emptyTitle: "No claimed leads",
    emptyHint: "Claim one from Live Leads or Shark Tank.",
  },
  {
    key: "quoted",
    label: "Quoted",
    accent: "border-t-sky-500",
    dot: "text-sky-400",
    emptyTitle: "No quotes in flight",
    emptyHint: "Move leads here once you've sent a quote.",
  },
  {
    key: "follow_up",
    label: "Follow Up",
    accent: "border-t-amber-500",
    dot: "text-amber-400",
    emptyTitle: "No follow-ups scheduled",
    emptyHint: "Drag a lead here and set a callback time.",
  },
  {
    key: "x_date",
    label: "X-Date",
    accent: "border-t-violet-500",
    dot: "text-violet-400",
    emptyTitle: "No X-Dates yet",
    emptyHint: "Drag leads here when they have a renewal date.",
  },
  {
    key: "sold",
    label: "Sold",
    accent: "border-t-emerald-500",
    dot: "text-emerald-400",
    emptyTitle: "No sales yet today",
    emptyHint: "Close one and move it here.",
  },
];

// ----- Lead intelligence helpers (UI-only, derived from existing fields) -----

type Priority = { label: "HOT" | "GOOD" | "NEEDS WORK" | "LOW INFO"; className: string; score: number };

function priorityFor(lead: BoardLead): Priority {
  // Prefer the precomputed score_tier if present, else derive.
  const tier = lead.score_tier ?? null;
  if (tier === "S") return { label: "HOT", className: "bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30", score: lead.composite_score ?? 90 };
  if (tier === "A") return { label: "GOOD", className: "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30", score: lead.composite_score ?? 75 };
  if (tier === "B") return { label: "NEEDS WORK", className: "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30", score: lead.composite_score ?? 55 };
  if (tier === "C") return { label: "LOW INFO", className: "bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-500/30", score: lead.composite_score ?? 30 };

  const hasCarrier = !!lead.current_carrier;
  const vehicles = lead.num_vehicles ?? 0;
  const aged = lead.list_type === "aged";
  let s = 40;
  if (hasCarrier) s += 20;
  if (vehicles >= 4) s += 25;
  else if (vehicles >= 2) s += 15;
  else if (vehicles === 1) s += 5;
  if (aged) s += 10;
  if (lead.phone) s += 5;

  if (s >= 80) return { label: "HOT", className: "bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30", score: s };
  if (s >= 60) return { label: "GOOD", className: "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30", score: s };
  if (s >= 40) return { label: "NEEDS WORK", className: "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30", score: s };
  return { label: "LOW INFO", className: "bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-500/30", score: s };
}

function nextActionFor(lead: BoardLead): { label: string; tone: "urgent" | "warn" | "info" | "neutral" } {
  if (!lead.current_carrier) return { label: "Missing Carrier", tone: "warn" };
  if ((lead.num_vehicles ?? 0) === 0) return { label: "Needs Vehicle Info", tone: "warn" };
  if (lead.dispo === "follow_up" && lead.follow_up_at) {
    const due = new Date(lead.follow_up_at).getTime();
    const now = Date.now();
    const dayMs = 86400000;
    if (due <= now) return { label: "Overdue Follow-Up", tone: "urgent" };
    if (due - now <= dayMs) return { label: "Follow Up Today", tone: "warn" };
    return { label: "Follow Up Scheduled", tone: "info" };
  }
  if (lead.dispo === "quoted") return { label: "Quote Pending", tone: "info" };
  if (lead.dispo === "x_date") return { label: "X-Date Scheduled", tone: "info" };
  if (lead.dispo === "sold") return { label: "Closed", tone: "neutral" };
  return { label: "Call Now", tone: "urgent" };
}

function overdueDaysLabel(iso: string | null): string | null {
  if (!iso) return null;
  const due = new Date(iso).getTime();
  const now = Date.now();
  if (due > now) return null;
  const days = Math.floor((now - due) / 86400000);
  if (days === 0) return "Overdue today";
  if (days === 1) return "Overdue by 1 day";
  return `Overdue by ${days} days`;
}

const QUICK_FILTERS = [
  { key: "overdue", label: "Overdue" },
  { key: "aged", label: "Aged" },
  { key: "requote", label: "Requote" },
  { key: "multi", label: "2+ Vehicles" },
  { key: "no_carrier", label: "No Carrier" },
  { key: "hot", label: "High Priority" },
] as const;
type QuickFilter = (typeof QUICK_FILTERS)[number]["key"];

// Combine auto + home dispos to pick the column this lead belongs in.
// A sale on EITHER side wins (so home-only sales leave the Claimed column).
const COLUMN_PRIORITY: Record<string, number> = {
  sold: 50,
  x_date: 40,
  follow_up: 30,
  quoted: 20,
  none: 0,
};
function rankFor(d: Dispo | null | undefined): number {
  const key = (d ?? "none") as string;
  return COLUMN_PRIORITY[key] ?? 0;
}
function effectiveColumnKey(lead: BoardLead, uid?: string): string {
  // Shared leads always land in Claimed for the recipient, regardless of the
  // underlying lead's dispo (set by the original owner).
  if (lead.is_shared) return "none";

  // Viewer-aware column placement: only consider the sides the current user
  // is the claimant on. A sale by another agent on the *other* side should
  // not pull this viewer's card into Sold.
  const ownsAuto = !!uid && lead.claimed_by === uid;
  const ownsHome = !!uid && lead.home_claimed_by === uid;
  const ownsAny = ownsAuto || ownsHome;

  // Extra lines (flood, umbrella, boat, etc.) aren't tied to a side, so only
  // count a sold extra line when the viewer owns at least one main side on
  // this lead — otherwise it's not "their" sale to surface.
  if (ownsAny && hasSoldExtraLine(lead)) return "sold";

  // Defense-in-depth: a side with a positive quoted_premium but a null dispo
  // (legacy rows where premium was entered without a dispo) should surface in
  // the Quoted column for the owner. DB stays as-is; this is column-key only.
  const autoKey = lead.dispo ?? ((lead.quoted_premium ?? 0) > 0 ? "quoted" : "none");
  const homeKey = lead.home_dispo ?? ((lead.home_quoted_premium ?? 0) > 0 ? "quoted" : "none");
  const autoRank = rankFor(lead.dispo) || ((lead.quoted_premium ?? 0) > 0 ? COLUMN_PRIORITY["quoted"] : 0);
  const homeRank = rankFor(lead.home_dispo) || ((lead.home_quoted_premium ?? 0) > 0 ? COLUMN_PRIORITY["quoted"] : 0);

  let pick: string;
  if (ownsAuto && ownsHome) {
    pick = autoRank >= homeRank ? autoKey : homeKey;
  } else if (ownsAuto) {
    pick = autoKey;
  } else if (ownsHome) {
    pick = homeKey;
  } else {
    // Viewer owns neither side (e.g. admin / legacy view). Fall back to the
    // original "any side wins" behavior so the card doesn't disappear.
    pick = autoRank >= homeRank ? autoKey : homeKey;
    if (hasSoldExtraLine(lead)) return "sold";
  }
  return (COLUMN_PRIORITY[pick] ?? 0) > 0 ? pick : "none";
}
function soldSides(lead: BoardLead): string[] {
  const sides: string[] = [];
  if (lead.dispo === "sold") sides.push("auto");
  if (lead.home_dispo === "sold") sides.push("home");
  for (const t of soldExtraLineTypes(lead)) sides.push(t);
  return sides;
}
function homeApplicable(lead: BoardLead): boolean {
  return (
    !!lead.housing_status ||
    lead.home_dispo != null ||
    (lead.home_quoted_premium ?? 0) > 0
  );
}

// Pick which side a my-leads-board action should target, based on what the
// viewer actually owns. Prevents a home-only owner from writing to the
// auto side (and vice versa) when they drag a card between columns.
function resolveViewerSide(lead: BoardLead, uid?: string): "auto" | "home" {
  const ownsAuto = !!uid && lead.claimed_by === uid;
  const ownsHome = !!uid && lead.home_claimed_by === uid;
  if (ownsHome && !ownsAuto) return "home";
  return "auto";
}

function MyLeadsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const isSales = useHasRole("sales", "admin");
  const isAdmin = useHasRole("admin");
  const listAgentsFn = useServerFn(listSalesAgents);
  const agentsQ = useQuery({
    queryKey: ["sales-agents-viewas"],
    queryFn: () => listAgentsFn(),
    enabled: isAdmin,
  });
  const [viewAs, setViewAs] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Shield className="h-8 w-8 animate-pulse text-primary" />
      </div>
    );
  }

  const effectiveUid = viewAs ?? user.id;
  const viewingOther = isAdmin && viewAs && viewAs !== user.id;
  const agents = (agentsQ.data ?? []) as Array<{ id: string; full_name: string | null; email: string }>;

  return (
    <AppShell>
      {isSales ? (
        <Board
          uid={effectiveUid}
          readOnly={Boolean(viewingOther)}
          viewAsControl={
            isAdmin ? (
              <InlineViewAs
                viewAs={viewAs}
                onChange={setViewAs}
                agents={agents.filter((a) => a.id !== user.id)}
                viewingOther={Boolean(viewingOther)}
              />
            ) : null
          }
        />
      ) : (
        <NotSales />
      )}
    </AppShell>
  );
}

function InlineViewAs({
  viewAs,
  onChange,
  agents,
  viewingOther,
}: {
  viewAs: string | null;
  onChange: (v: string | null) => void;
  agents: Array<{ id: string; full_name: string | null; email: string }>;
  viewingOther: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
      <span className="hidden sm:inline">Viewing:</span>
      <Select value={viewAs ?? "__me__"} onValueChange={(v) => onChange(v === "__me__" ? null : v)}>
        <SelectTrigger className="h-7 w-[180px] border-border/60 bg-card text-[12px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__me__">Myself</SelectItem>
          {agents.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.full_name || a.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {viewingOther && <span className="hidden md:inline text-[11px]">read-only</span>}
    </div>
  );
}

function NotSales() {
  return (
    <Card className="mx-auto max-w-2xl">
      <CardContent className="pt-6 text-sm text-muted-foreground">
        My Leads is only available to sales agents.
      </CardContent>
    </Card>
  );
}

function Board({
  uid,
  readOnly = false,
  viewAsControl,
}: {
  uid: string;
  readOnly?: boolean;
  viewAsControl?: React.ReactNode;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { openLead } = Route.useSearch();
  const [detailKey, setDetailKey] = useState<{ source: "leads" | "list_leads"; id: string } | null>(null);
  const listAgentsFn = useServerFn(listSalesAgents);
  const agentsQ = useQuery({
    queryKey: ["sales-agents-myleads"],
    queryFn: () => listAgentsFn(),
  });
  const agents = (agentsQ.data ?? []) as Array<{ id: string; full_name: string | null; email: string; avatar_url?: string | null }>;
  const [pendingFollowUp, setPendingFollowUp] = useState<{ lead: BoardLead; side: "auto" | "home" } | null>(null);
  const [pendingXDate, setPendingXDate] = useState<{ lead: BoardLead; side: "auto" | "home" } | null>(null);
  const [pendingNotQuoted, setPendingNotQuoted] = useState<{ lead: BoardLead; side: "auto" | "home" } | null>(null);
  const [pendingSold, setPendingSold] = useState<{ lead: BoardLead; side: "auto" | "home" } | null>(null);
  const [pendingSoldSidePick, setPendingSoldSidePick] = useState<BoardLead | null>(null);
  const [pendingUnsold, setPendingUnsold] = useState<{ lead: BoardLead; dispo: Dispo | null; side: "auto" | "home" } | null>(null);
  const [viewMode, setViewMode] = useState<"board" | "list" | "calendar">("board");
  const [searchQ, setSearchQ] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<QuickFilter>>(new Set());
  const [sortMode, setSortMode] = useState<"recent" | "priority">("recent");

  const liveQ = useQuery({
    queryKey: ["my-leads-live", uid],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, first_name, last_name, phone, email, city, state, current_carrier, num_vehicles, dispo, quoted_premium, follow_up_at, claimed_at, created_at, claimed_by, home_claimed_by, home_claimed_at, agent_notes, lead_type, vendor_id, housing_status, composite_score, score_tier, auto_sale_type, home_sale_type, home_dispo, home_quoted_premium, auto_policies_count, home_policies_count, auto_motor_club_premium, lead_lines")
        .or(`claimed_by.eq.${uid},agent_id.eq.${uid},home_claimed_by.eq.${uid}`);
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, source: "leads" as const, list_type: null }));
    },
  });

  const listQ = useQuery({
    queryKey: ["my-leads-list", uid],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("list_leads")
        .select("id, first_name, last_name, phone, email, city, state, current_carrier, num_vehicles, dispo, quoted_premium, follow_up_at, list_type, claimed_at, created_at, claimed_by, home_claimed_by, home_claimed_at, agent_notes, lead_type, vendor_id, housing_status, composite_score, score_tier, auto_sale_type, home_sale_type, home_dispo, home_quoted_premium, auto_policies_count, home_policies_count, auto_motor_club_premium, lead_lines")
        .or(`claimed_by.eq.${uid},agent_id.eq.${uid},home_claimed_by.eq.${uid}`);
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, source: "list_leads" as const }));
    },
  });

  const sharedQ = useQuery({
    queryKey: ["my-leads-shared", uid],
    enabled: !!uid,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data: shares, error: sErr } = await supabase
        .from("lead_shares")
        .select("lead_id, lead_table")
        .eq("shared_with", uid);
      if (sErr) throw sErr;
      const liveIds = (shares ?? []).filter((s) => s.lead_table === "leads").map((s) => s.lead_id);
      const listIds = (shares ?? []).filter((s) => s.lead_table === "list_leads").map((s) => s.lead_id);
      const out: BoardLead[] = [];
      if (liveIds.length) {
        const { data, error } = await supabase
          .from("leads")
          .select("id, first_name, last_name, phone, email, city, state, current_carrier, num_vehicles, dispo, quoted_premium, follow_up_at, claimed_at, created_at, claimed_by, home_claimed_by, home_claimed_at, agent_notes, lead_type, vendor_id, housing_status, composite_score, score_tier, auto_sale_type, home_sale_type, home_dispo, home_quoted_premium, auto_policies_count, home_policies_count, auto_motor_club_premium, lead_lines")
          .in("id", liveIds);
        if (error) throw error;
        for (const r of data ?? []) out.push({ ...r, source: "leads", list_type: null, is_shared: true } as BoardLead);
      }
      if (listIds.length) {
        const { data, error } = await supabase
          .from("list_leads")
          .select("id, first_name, last_name, phone, email, city, state, current_carrier, num_vehicles, dispo, quoted_premium, follow_up_at, list_type, claimed_at, created_at, claimed_by, home_claimed_by, home_claimed_at, agent_notes, lead_type, vendor_id, housing_status, composite_score, score_tier, auto_sale_type, home_sale_type, home_dispo, home_quoted_premium, auto_policies_count, home_policies_count, auto_motor_club_premium, lead_lines")
          .in("id", listIds);
        if (error) throw error;
        for (const r of data ?? []) out.push({ ...r, source: "list_leads", is_shared: true } as BoardLead);
      }
      return out;
    },
  });

  // Realtime: keep claimed/shared boards in sync as leads change.
  useEffect(() => {
    const channel = supabase
      .channel(`my-leads-${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => {
        qc.invalidateQueries({ queryKey: ["my-leads-live", uid] });
        qc.invalidateQueries({ queryKey: ["my-leads-shared", uid] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "list_leads" }, () => {
        qc.invalidateQueries({ queryKey: ["my-leads-list", uid] });
        qc.invalidateQueries({ queryKey: ["my-leads-shared", uid] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_shares", filter: `shared_with=eq.${uid}` }, () => {
        qc.invalidateQueries({ queryKey: ["my-leads-shared", uid] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, uid]);

  const all: BoardLead[] = useMemo(
    () => {
      const own = [...(liveQ.data ?? []), ...(listQ.data ?? [])] as BoardLead[];
      const ownKeys = new Set(own.map((l) => `${l.source}:${l.id}`));
      const shared = (sharedQ.data ?? []).filter((l) => !ownKeys.has(`${l.source}:${l.id}`));
      return [...own, ...shared];
    },
    [liveQ.data, listQ.data, sharedQ.data],
  );

  const filteredAll = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return all.filter((l) => {
      if (q) {
        const name = `${l.first_name ?? ""} ${l.last_name ?? ""}`.toLowerCase();
        const carrier = (l.current_carrier ?? "").toLowerCase();
        const city = (l.city ?? "").toLowerCase();
        const state = (l.state ?? "").toLowerCase();
        const phoneDigits = (l.phone ?? "").replace(/\D/g, "");
        const matches =
          name.includes(q) ||
          carrier.includes(q) ||
          city.includes(q) ||
          state.includes(q) ||
          (digits.length > 0 && phoneDigits.includes(digits));
        if (!matches) return false;
      }
      if (activeFilters.size === 0) return true;
      const overdue =
        l.dispo === "follow_up" && l.follow_up_at && new Date(l.follow_up_at).getTime() <= Date.now();
      const checks: Record<QuickFilter, boolean> = {
        overdue: Boolean(overdue),
        aged: l.list_type === "aged",
        requote: l.list_type === "requote",
        multi: (l.num_vehicles ?? 0) >= 2,
        no_carrier: !l.current_carrier,
        hot: priorityFor(l).label === "HOT",
      };
      for (const f of activeFilters) {
        if (!checks[f]) return false;
      }
      return true;
    });
  }, [all, searchQ, activeFilters]);

  const vendorIds = useMemo(() => Array.from(new Set(all.map((l) => l.vendor_id).filter((x): x is string => !!x))), [all]);
  const lookupVendors = useServerFn(lookupVendorNames);
  const vendorsQ = useQuery({
    queryKey: ["my-leads-vendor-names", vendorIds],
    queryFn: () => lookupVendors({ data: { vendor_ids: vendorIds } }),
    enabled: vendorIds.length > 0,
  });
  const vendorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of vendorsQ.data ?? []) m.set(v.id, v.company_name || v.full_name || v.email);
    return m;
  }, [vendorsQ.data]);

  const byCol = useMemo(() => {
    const m = new Map<string, BoardLead[]>();
    for (const c of COLUMNS) m.set(c.key, []);
    for (const l of filteredAll) {
      const key = effectiveColumnKey(l, uid);
      if (m.has(key)) m.get(key)!.push(l);
      else m.get("none")!.push(l);
    }
    for (const [, arr] of m) {
      arr.sort((a, b) => {
        if (sortMode === "priority") {
          return priorityFor(b).score - priorityFor(a).score;
        }
        if (a.dispo === "follow_up" && b.dispo === "follow_up") {
          return (new Date(a.follow_up_at ?? a.created_at).getTime()) - (new Date(b.follow_up_at ?? b.created_at).getTime());
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    }
    return m;
  }, [filteredAll, sortMode, uid]);


  const updateDispoM = useMutation({
    mutationFn: async ({
      lead,
      dispo,
      followUpAt,
      xDate,
      agentNotes,
      saleType,
      motorClubPremium,
      premium,
      side = "auto",
    }: {
      lead: BoardLead;
      dispo: Dispo | null;
      followUpAt?: string | null;
      xDate?: string | null;
      agentNotes?: string | null;
      saleType?: SaleType | null;
      motorClubPremium?: number | null;
      premium?: number | null;
      side?: "auto" | "home";
    }) => {
      const isHome = side === "home";
      const patch: Record<string, unknown> = isHome
        ? {
            home_dispo: dispo,
            home_follow_up_at:
              dispo === "follow_up"
                ? followUpAt ?? null
                : null,
            ...(dispo === "x_date" && xDate ? { home_x_date: xDate } : {}),
            ...(agentNotes !== undefined ? { home_agent_notes: agentNotes } : {}),
            ...(dispo === "sold" && saleType !== undefined ? { home_sale_type: saleType } : {}),
            ...(dispo !== "sold" ? { home_sale_type: null } : {}),
            ...(dispo === "sold" && premium != null ? { home_quoted_premium: premium } : {}),
            ...(dispo != null && !lead.home_claimed_by && uid
              ? { home_claimed_by: uid }
              : {}),
          }
        : {
            dispo,
            follow_up_at:
              dispo === "follow_up"
                ? followUpAt ?? lead.follow_up_at ?? null
                : null,
            ...(dispo === "x_date" && xDate ? { x_date: xDate } : {}),
            ...(agentNotes !== undefined ? { agent_notes: agentNotes } : {}),
            ...(dispo === "sold" && saleType !== undefined ? { auto_sale_type: saleType } : {}),
            ...(dispo !== "sold" ? { auto_sale_type: null } : {}),
            ...(dispo === "sold" && premium != null ? { quoted_premium: premium } : {}),
            ...(dispo === "sold"
              ? { auto_motor_club_premium: motorClubPremium ?? null }
              : { auto_motor_club_premium: null }),
            ...(dispo != null && !lead.claimed_by && uid
              ? { claimed_by: uid, claimed_at: new Date().toISOString() }
              : {}),
          };
      const { error } = await supabase
        .from(lead.source)
        .update(patch as never)
        .eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["my-leads-live"] });
      qc.invalidateQueries({ queryKey: ["my-leads-list"] });
      qc.invalidateQueries({ queryKey: ["my-leads-shared"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update"),
  });

  const requestDispoChange = (lead: BoardLead, dispo: Dispo | null) => {
    if (readOnly) return;
    const side = resolveViewerSide(lead, uid);
    // Guard: only erase the sale on the side actually being changed. Leaves
    // the other side's sale untouched (e.g. moving Home → Follow Up when
    // Auto is Sold should not prompt to erase the Auto sale).
    const sideSold =
      (side === "auto" && lead.dispo === "sold") ||
      (side === "home" && lead.home_dispo === "sold");
    if (sideSold && dispo !== "sold") {
      setPendingUnsold({ lead, dispo, side });
      return;
    }
    if (dispo === "sold") {
      // Pick which side this sale should land on. If both sides are open and
      // home is applicable, ask the user — otherwise default to the open side.
      const autoOpen = lead.dispo !== "sold";
      const homeOpen = (lead.home_dispo ?? null) !== "sold";
      const homeOk = homeApplicable(lead);
      if (autoOpen && homeOpen && homeOk) {
        setPendingSoldSidePick(lead);
      } else if (homeOpen && homeOk && !autoOpen) {
        setPendingSold({ lead, side: "home" });
      } else {
        setPendingSold({ lead, side: "auto" });
      }
      return;
    }
    if (dispo === "follow_up") {
      setPendingFollowUp({ lead, side });
      return;
    }
    if (dispo === "x_date") {
      setPendingXDate({ lead, side });
      return;
    }
    if (dispo === "not_quoted") {
      setPendingNotQuoted({ lead, side });
      return;
    }
    updateDispoM.mutate({ lead, dispo, side });
  };

  const releaseM = useMutation({
    mutationFn: async (lead: BoardLead) => {
      const { error } = await supabase
        .from(lead.source)
        .update({ claimed_by: null, claimed_at: null, agent_id: null })
        .eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lead released");
      qc.invalidateQueries({ queryKey: ["my-leads-live"] });
      qc.invalidateQueries({ queryKey: ["my-leads-list"] });
      qc.invalidateQueries({ queryKey: ["my-leads-shared"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to release"),
  });

  const openDetail = (lead: BoardLead) => {
    setDetailKey({ source: lead.source, id: lead.id });
  };

  // Reactive fetch of the full lead. Keyed so any invalidation (including
  // from DispoPanel inside the dialog) triggers a refetch, which is what
  // makes Auto-archive restore actually see fresh `auto_archive` data.
  const detailQ = useQuery({
    queryKey: ["my-leads-detail", detailKey?.source, detailKey?.id],
    enabled: !!detailKey,
    queryFn: async () => {
      if (!detailKey) return null;
      const { data, error } = await supabase
        .from(detailKey.source)
        .select("*")
        .eq("id", detailKey.id)
        .single();
      if (error) throw error;
      const full: FullLead = {
        ...(data as Record<string, unknown>),
        source: detailKey.source,
        vehicles: Array.isArray((data as Record<string, unknown>).vehicles)
          ? ((data as Record<string, unknown>).vehicles as Vehicle[])
          : [],
        num_vehicles: (data as Record<string, unknown>).num_vehicles ?? 0,
      } as FullLead;
      return full;
    },
  });
  const detailLead = detailQ.data ?? null;

  const isLoading = liveQ.isLoading || listQ.isLoading;

  useEffect(() => {
    if (!openLead || isLoading) return;
    const [source, id] = openLead.split(":");
    const lead = all.find((l) => l.source === source && l.id === id);
    if (lead) {
      openDetail(lead);
      navigate({ to: "/my-leads", search: {}, replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openLead, isLoading, all.length]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const activeDragLead = activeDragId
    ? all.find((l) => `${l.source}:${l.id}` === activeDragId) ?? null
    : null;

  const onDragStart = (e: DragStartEvent) => {
    setActiveDragId(String(e.active.id));
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    if (readOnly) return;
    const overId = e.over?.id as string | undefined;
    const activeId = e.active?.id as string | undefined;
    if (!overId || !activeId) return;
    const lead = all.find((l) => `${l.source}:${l.id}` === activeId);
    if (!lead) return;
    const newDispo: Dispo | null = overId === "none" ? null : (overId as Dispo);
    if ((lead.dispo ?? "none") === (newDispo ?? "none")) return;
    requestDispoChange(lead, newDispo);
  };

  return (
    <>
      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <HeroTitle label="My Leads" icon={ClipboardCheck} />
            {viewAsControl}
          </div>
        }
        action={
          !readOnly && (
            <Button asChild size="sm" variant="outline" className="h-9 gap-1.5">
              <Link to="/leads/new"><Plus className="h-3.5 w-3.5" /> Add lead</Link>
            </Button>
          )
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {QUICK_FILTERS.map((f) => {
            const active = activeFilters.has(f.key);
            return (
              <button
                key={f.key}
                type="button"
                onClick={() =>
                  setActiveFilters((prev) => {
                    const next = new Set(prev);
                    if (next.has(f.key)) next.delete(f.key);
                    else next.add(f.key);
                    return next;
                  })
                }
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border/60 bg-card text-muted-foreground hover:border-border hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            );
          })}
          {activeFilters.size > 0 && (
            <button
              type="button"
              onClick={() => setActiveFilters(new Set())}
              className="ml-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={sortMode} onValueChange={(v) => setSortMode(v as "recent" | "priority")}>
            <SelectTrigger className="h-8 w-[150px] border-border/60 bg-card text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Sort: Newest</SelectItem>
              <SelectItem value="priority">Sort: Priority</SelectItem>
            </SelectContent>
          </Select>
          <Tabs
            value={viewMode}
            onValueChange={(v) => {
              const val = v as "board" | "list" | "calendar";
              if (val === "calendar") navigate({ to: "/follow-ups" });
              else setViewMode(val);
            }}
          >
            <TabsList className="h-8">
              <TabsTrigger value="board" className="h-7 px-2 text-[12px]">
                <LayoutGrid className="mr-1 h-3.5 w-3.5" /> Board
              </TabsTrigger>
              <TabsTrigger value="list" className="h-7 px-2 text-[12px]">
                <ListIcon className="mr-1 h-3.5 w-3.5" /> List
              </TabsTrigger>
              <TabsTrigger value="calendar" className="h-7 px-2 text-[12px]">
                <CalendarDays className="mr-1 h-3.5 w-3.5" /> Calendar
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      {isLoading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Loading your board…</div>
      ) : all.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <EmptyCTA
              icon={Inbox}
              title="Your board is empty — let's fix that."
              description="Claim a fresh lead from the live queue, or grab a released one from Shark Tank. Every claim builds your pipeline and your activity score."
              actions={[
                { label: "Browse Live Leads", to: "/call-queue" },
                { label: "Open Shark Tank", to: "/shark-tank" },
                { label: "Add Lead Manually", to: "/leads/new", variant: "secondary" },
              ]}
            />
          </CardContent>
        </Card>
      ) : viewMode === "list" ? (
        <LeadListView
          leads={filteredAll}
          uid={uid}
          vendorMap={vendorMap}
          onOpen={(l) => openDetail(l)}
          onDispoChange={(l, d) => requestDispoChange(l, d)}
          onRelease={(l) => releaseM.mutate(l)}
          readOnly={readOnly}
        />
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveDragId(null)}
        >
          <div className="-mx-1 overflow-x-auto pb-4 lg:mx-0 lg:overflow-visible">
            <div className="grid min-w-[900px] grid-cols-5 gap-2 px-1 lg:min-w-0">
              {COLUMNS.map((col) => {
                const items = byCol.get(col.key) ?? [];
                return (
                  <DroppableColumn key={col.key} col={col} count={items.length}>
                    {items.length === 0 ? (
                      <div className="flex flex-col items-start gap-0.5 px-1 py-6 text-left">
                        <div className="text-[12px] font-semibold text-foreground/80">{col.emptyTitle}</div>
                        <div className="text-[11px] text-muted-foreground/80">{col.emptyHint}</div>
                      </div>
                    ) : (
                      items.map((l) => (
                        <DraggableCard key={`${l.source}:${l.id}`} dragId={`${l.source}:${l.id}`}>
                          <LeadCard
                            lead={l}
                            uid={uid}
                            vendorName={vendorMap.get(l.vendor_id ?? "") ?? null}
                            onClick={() => openDetail(l)}
                            onRelease={() => releaseM.mutate(l)}
                          />
                        </DraggableCard>
                      ))
                    )}
                  </DroppableColumn>
                );
              })}
            </div>
          </div>
          <DragOverlay dropAnimation={null}>
            {activeDragLead ? (
              <div className="rotate-1 cursor-grabbing shadow-2xl ring-2 ring-primary/40 rounded-md">
                <LeadCard
                  lead={activeDragLead}
                  uid={uid}
                  vendorName={vendorMap.get(activeDragLead.vendor_id ?? "") ?? null}
                  onClick={() => {}}
                  onRelease={() => {}}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
      <FollowUpScheduleDialog
        lead={pendingFollowUp?.lead ?? null}
        onClose={() => setPendingFollowUp(null)}
        onConfirm={(iso) => {
          if (!pendingFollowUp) return;
          updateDispoM.mutate({ lead: pendingFollowUp.lead, dispo: "follow_up", followUpAt: iso, side: pendingFollowUp.side });
          setPendingFollowUp(null);
        }}
      />
      <XDateScheduleDialog
        lead={pendingXDate?.lead ?? null}
        onClose={() => setPendingXDate(null)}
        onConfirm={(date: string) => {
          if (!pendingXDate) return;
          updateDispoM.mutate({ lead: pendingXDate.lead, dispo: "x_date", xDate: date, side: pendingXDate.side });
          setPendingXDate(null);
        }}
      />
      <NotQuotedReasonDialog
        lead={pendingNotQuoted?.lead ?? null}
        onClose={() => setPendingNotQuoted(null)}
        onConfirm={(notes: string) => {
          if (!pendingNotQuoted) return;
          updateDispoM.mutate({ lead: pendingNotQuoted.lead, dispo: "not_quoted", agentNotes: notes, side: pendingNotQuoted.side });
          setPendingNotQuoted(null);
        }}
      />
      <SaleTypeDialog
        open={!!pendingSold}
        side={pendingSold?.side ?? "auto"}
        defaultValue={
          pendingSold?.side === "home"
            ? pendingSold.lead.home_sale_type ?? null
            : pendingSold?.lead.auto_sale_type ?? null
        }
        defaultMotorClubPremium={
          pendingSold?.side === "auto"
            ? pendingSold.lead.auto_motor_club_premium ?? null
            : null
        }
        premium={
          pendingSold?.side === "home"
            ? pendingSold.lead.home_quoted_premium ?? null
            : pendingSold?.lead.quoted_premium ?? null
        }
        leadName={
          pendingSold
            ? `${pendingSold.lead.first_name ?? ""} ${pendingSold.lead.last_name ?? ""}`.trim() || null
            : null
        }
        onCancel={() => setPendingSold(null)}
        onConfirm={({ saleType, motorClubPremium, premium }) => {
          if (!pendingSold) return;
          updateDispoM.mutate({
            lead: pendingSold.lead,
            dispo: "sold",
            saleType,
            motorClubPremium,
            premium,
            side: pendingSold.side,
          });
          setPendingSold(null);
        }}
      />
      <AlertDialog
        open={pendingSoldSidePick !== null}
        onOpenChange={(o) => !o && setPendingSoldSidePick(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Which policy did you sell?</AlertDialogTitle>
            <AlertDialogDescription>
              This lead has both an auto and a home side. Pick the one this sale
              belongs to. You can come back and mark the other side sold separately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel className="sm:mr-auto">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingSoldSidePick) return;
                setPendingSold({ lead: pendingSoldSidePick, side: "home" });
                setPendingSoldSidePick(null);
              }}
            >
              Home policy
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                if (!pendingSoldSidePick) return;
                setPendingSold({ lead: pendingSoldSidePick, side: "auto" });
                setPendingSoldSidePick(null);
              }}
            >
              Auto policy
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <LeadWorkspaceDialog
        lead={detailLead as never}
        onClose={() => {
          setDetailKey(null);
          qc.invalidateQueries({ queryKey: ["my-leads-live"] });
          qc.invalidateQueries({ queryKey: ["my-leads-list"] });
          qc.invalidateQueries({ queryKey: ["my-leads-shared"] });
        }}
        agents={agents}
        source={(detailLead?.source ?? "leads") as "leads" | "list_leads"}
        invalidateKeys={[
          ["my-leads-live"],
          ["my-leads-list"],
          ["my-leads-shared"],
          ["my-leads-detail", detailKey?.source, detailKey?.id],
        ]}
      />
      <AlertDialog open={pendingUnsold !== null} onOpenChange={(o) => !o && setPendingUnsold(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Erase this sale?</AlertDialogTitle>
            <AlertDialogDescription>
              The <strong>{pendingUnsold?.side ?? "auto"}</strong> side is currently marked{" "}
              <strong>Sold</strong>. Moving this side to{" "}
              <strong className="capitalize">
                {(pendingUnsold?.dispo ?? "none").toString().replace(/_/g, " ")}
              </strong>{" "}
              will erase the sale, clear the policy type, and adjust commissions, leaderboards, and reporting tied to it.
              <br />
              <br />
              This cannot be undone automatically — you'll need to re-mark as Sold to restore it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep sale</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingUnsold) return;
                const { lead, dispo, side } = pendingUnsold;
                setPendingUnsold(null);
                // Erase the sale on the side being changed, then route that
                // same side through the normal dispo flow for the new status.
                updateDispoM.mutate({ lead, dispo: null, side });
                if (dispo === "follow_up") setPendingFollowUp({ lead, side });
                else if (dispo === "x_date") setPendingXDate({ lead, side });
                else if (dispo === "not_quoted") setPendingNotQuoted({ lead, side });
                else if (dispo !== null) updateDispoM.mutate({ lead, dispo, side });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, erase sale
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}


function NextActionPill({ tone, children }: { tone: "urgent" | "warn" | "info" | "neutral"; children: ReactNode }) {
  const cls =
    tone === "urgent"
      ? "bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30"
      : tone === "warn"
      ? "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30"
      : tone === "info"
      ? "bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/30"
      : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {children}
    </span>
  );
}

function LeadCard({
  lead,
  uid,
  vendorName,
  onClick,
  onRelease,
}: {
  lead: BoardLead;
  uid: string;
  vendorName?: string | null;
  onClick: () => void;
  onRelease: () => void;
}) {
  void vendorName;
  const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unnamed";
  const action = nextActionFor(lead);
  const overdueText = lead.dispo === "follow_up" ? overdueDaysLabel(lead.follow_up_at) : null;

  // Subline parts (skip empty).
  const subParts: string[] = [];
  if (lead.current_carrier) subParts.push(lead.current_carrier);
  if (lead.list_type) subParts.push(formatListType(lead.list_type));
  if ((lead.num_vehicles ?? 0) > 0) {
    subParts.push(`${lead.num_vehicles} ${lead.num_vehicles === 1 ? "vehicle" : "vehicles"}`);
  }

  // Tag set, capped at 3.
  const tags: Array<{ key: string; label: string; cls: string }> = [];
  const dispoLabel = lead.dispo
    ? DISPO_OPTIONS.find((x) => x.value === lead.dispo)?.label ?? lead.dispo
    : "Claimed";
  tags.push({
    key: "dispo",
    label: dispoLabel,
    cls:
      lead.dispo === "sold"
        ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-500/30"
        : lead.dispo === "quoted"
        ? "bg-sky-500/10 text-sky-300 ring-1 ring-inset ring-sky-500/30"
        : lead.dispo === "follow_up"
        ? "bg-amber-500/10 text-amber-300 ring-1 ring-inset ring-amber-500/30"
        : lead.dispo === "x_date"
        ? "bg-violet-500/10 text-violet-300 ring-1 ring-inset ring-violet-500/30"
        : "bg-muted text-muted-foreground ring-1 ring-inset ring-border/50",
  });
  const lt = leadTypeBadgeProps(lead.lead_type);
  if (lt) {
    tags.push({
      key: "lt",
      label: lt.label,
      cls: "bg-muted text-muted-foreground ring-1 ring-inset ring-border/50",
    });
  }
  if (lead.is_shared) {
    tags.push({
      key: "shared",
      label: "Shared",
      cls: "bg-indigo-500/10 text-indigo-300 ring-1 ring-inset ring-indigo-500/30",
    });
  }
  const visibleTags = tags.slice(0, 3);

  return (
    <Card
      className="group relative overflow-hidden rounded-lg border border-border/60 bg-card text-card-foreground shadow-sm transition-colors hover:border-border hover:bg-card/80 cursor-pointer"
      onClick={onClick}
    >
      {!lead.is_shared && (
        <button
          type="button"
          aria-label="Release lead"
          title="Release lead"
          onClick={(e) => {
            e.stopPropagation();
            onRelease();
          }}
          className="absolute right-1.5 top-1.5 z-10 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100 transition-opacity"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      <CardContent className="flex flex-col gap-2 p-2.5">
        {/* Top row: name + priority */}
        <div className="flex items-start justify-between gap-2 pr-5">
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold leading-tight tracking-tight text-foreground line-clamp-2">
              {name}
            </div>
            {subParts.length > 0 && (
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {subParts.join(" · ")}
              </div>
            )}
            {!lead.current_carrier && (
              <div className="mt-0.5 truncate text-[10.5px] font-medium text-amber-400">
                Missing carrier
              </div>
            )}
            {(lead.num_vehicles ?? 0) === 0 && lead.current_carrier && (
              <div className="mt-0.5 truncate text-[10.5px] font-medium text-amber-400">
                Missing vehicle info
              </div>
            )}
            {overdueText && (
              <div className="mt-0.5 truncate text-[10.5px] font-semibold text-rose-400">
                {overdueText}
              </div>
            )}
          </div>
        </div>

        {/* Next-action pill row */}
        <div className="flex flex-wrap items-center gap-1">
          <NextActionPill tone={action.tone}>{action.label}</NextActionPill>
          {visibleTags.map((t) => (
            <span
              key={t.key}
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${t.cls}`}
            >
              {t.label}
            </span>
          ))}
        </div>

        {/* Dominant Call button */}
        {lead.phone ? (
          <CallButton
            leadId={lead.id}
            leadTable={lead.source}
            phone={lead.phone}
            uid={uid}
            dnc={lead.dispo === "dnc"}
            className="mt-1 w-full justify-center rounded-md bg-primary px-3 py-2 text-[12.5px] font-semibold tracking-tight text-primary-foreground shadow-sm hover:bg-primary/90 hover:!no-underline [&>svg]:h-3.5 [&>svg]:w-3.5"
          />
        ) : (
          <div className="mt-1 rounded-md border border-dashed border-border/60 px-3 py-2 text-center text-[11px] font-medium text-muted-foreground">
            No phone on file
          </div>
        )}

      </CardContent>
    </Card>
  );
}

function DroppableColumn({
  col,
  count,
  children,
}: {
  col: ColumnDef;
  count: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-0 flex-col rounded-lg border border-t-2 border-border/60 ${col.accent} bg-muted/30 transition-colors ${
        isOver ? "ring-2 ring-primary/40 bg-muted/50" : ""
      }`}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-lg border-b border-border/60 bg-muted/60 px-2.5 py-2 backdrop-blur supports-[backdrop-filter]:bg-muted/40">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`text-[10px] ${col.dot}`} aria-hidden>●</span>
          <span className="truncate text-[11.5px] font-semibold uppercase tracking-wide text-foreground/90">
            {col.label}
          </span>
        </div>
        <span className="rounded bg-background/60 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-muted-foreground ring-1 ring-inset ring-border/60">
          {count}
        </span>
      </div>
      <div className="flex max-h-[calc(100vh-260px)] flex-col gap-1.5 overflow-y-auto p-1.5">
        {children}
      </div>
    </div>
  );
}

function DraggableCard({ dragId, children }: { dragId: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: dragId });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={isDragging ? "opacity-40" : ""}
    >
      {children}
    </div>
  );
}

function LeadListView({
  leads,
  uid,
  vendorMap,
  onOpen,
  onDispoChange,
  onRelease,
  readOnly,
}: {
  leads: BoardLead[];
  uid: string;
  vendorMap: Map<string, string>;
  onOpen: (l: BoardLead) => void;
  onDispoChange: (l: BoardLead, d: Dispo | null) => void;
  onRelease: (l: BoardLead) => void;
  readOnly: boolean;
}) {
  const sorted = useMemo(
    () =>
      [...leads].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [leads],
  );
  const dispoLabel = (d: Dispo | null) =>
    d ? DISPO_OPTIONS.find((x) => x.value === d)?.label ?? d : "No dispo";
  if (sorted.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          No leads match your search.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-left">Carrier</th>
                <th className="px-3 py-2 text-left">Source</th>
                <th className="px-3 py-2 text-left">Vendor</th>
                <th className="px-3 py-2 text-left">Created</th>
                <th className="px-3 py-2 text-left">Dispo</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => {
                const name = `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Unnamed";
                return (
                  <tr
                    key={`${l.source}:${l.id}`}
                    className="cursor-pointer border-b last:border-b-0 hover:bg-muted/30"
                    onClick={() => onOpen(l)}
                  >
                    <td className="px-3 py-2 font-medium">{name}</td>
                    <td className="px-3 py-2">
                      <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
                        {l.phone ? (
                          <CallButton leadId={l.id} leadTable={l.source} phone={l.phone} uid={uid} dnc={l.dispo === "dnc"} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">{l.current_carrier ?? "—"}</td>
                    <td className="px-3 py-2">
                      {l.source === "leads"
                        ? "Live"
                        : l.list_type
                          ? formatListType(l.list_type)
                          : "List"}
                    </td>
                    <td className="px-3 py-2">{vendorMap.get(l.vendor_id ?? "") ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                      {format(new Date(l.created_at), "M/d/yy, h:mm a")}
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={l.dispo ?? "none"}
                        onValueChange={(v) =>
                          onDispoChange(l, v === "none" ? null : (v as Dispo))
                        }
                        disabled={readOnly}
                      >
                        <SelectTrigger className="h-8 w-[140px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No dispo</SelectItem>
                          {DISPO_OPTIONS.map((d) => (
                            <SelectItem key={d.value} value={d.value}>
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      {!readOnly && !l.is_shared && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Release lead"
                          onClick={() => onRelease(l)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="divide-y md:hidden">
          {sorted.map((l) => {
            const name = `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Unnamed";
            return (
              <li
                key={`${l.source}:${l.id}`}
                className="cursor-pointer p-3 hover:bg-muted/30"
                onClick={() => onOpen(l)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate text-sm font-semibold">{name}</span>
                      <LeadScoreChip score={l.composite_score ?? null} tier={l.score_tier ?? null} size="xs" showTier={false} />
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      <Badge variant="outline" className="mr-1 px-1.5 py-0 text-[10px] uppercase">
                        {l.source === "leads" ? "Live" : l.list_type ? formatListType(l.list_type) : "List"}
                      </Badge>
                      {l.lead_type ? <span className="mr-1">{l.lead_type}</span> : null}
                      {l.current_carrier ?? "—"} · {dispoLabel(l.dispo)}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {(vendorMap.get(l.vendor_id ?? "") ?? "—")} ·{" "}
                      {format(new Date(l.created_at), "M/d/yy, h:mm a")}
                    </div>
                  </div>
                  <div onClick={(e) => e.stopPropagation()} className="flex flex-col items-end gap-1.5">
                    {l.phone && (
                      <CallButton leadId={l.id} leadTable={l.source} phone={l.phone} uid={uid} dnc={l.dispo === "dnc"} />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function LeadDetailDialog({
  lead,
  uid,
  onClose,
  onSaved,
}: {
  lead: FullLead | null;
  uid: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [editingPhone, setEditingPhone] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [stateVal, setStateVal] = useState("");
  const [zip, setZip] = useState("");
  const [county, setCounty] = useState("");
  const [carrier, setCarrier] = useState("");
  const [dob, setDob] = useState("");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vendorNotes, setVendorNotes] = useState("");

  useEffect(() => {
    if (lead) {
      setCurrent(lead.current_premium != null ? String(lead.current_premium) : "");
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
      setDob(lead.date_of_birth ?? "");
      setVehicles(Array.isArray(lead.vehicles) ? lead.vehicles : []);
      setVendorNotes(lead.vendor_notes ?? "");
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
        .from(lead.source)
        .update({
          current_premium: current ? Number(current) : null,
          first_name: firstName,
          last_name: lastName,
          phone,
          email: email || null,
          street: street || null,
          city: city || null,
          state: stateVal || null,
          zip: zip || null,
          county: county || null,
          current_carrier: carrier || null,
          date_of_birth: dob || null,
          vehicles: vehicles as unknown as never,
          num_vehicles: vehicles.length,
          vendor_notes: vendorNotes || null,
        })
        .eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lead updated");
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  const sourceLabel = lead?.source === "leads" ? "Live Transfer" : "List Lead";
  const subLabel = lead?.source === "leads" ? sourceLabel : lead?.list_type ? formatListType(lead.list_type) : sourceLabel;

  return (
    <Dialog open={!!lead} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {lead && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {firstName} {lastName}
                <Badge variant="outline" className="text-xs font-normal">
                  {subLabel}
                </Badge>
              </DialogTitle>
              <DialogDescription>
                {phone || "—"} · {street}, {city}, {stateVal} {zip} · {county} County
              </DialogDescription>
            </DialogHeader>

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
                  leadTable={lead.source}
                  phone={phone}
                  uid={uid}
                  stopPropagation={false}
                  dnc={(lead.dispo as string | null) === "dnc"}
                  className="!inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 !text-sm font-semibold !text-primary-foreground shadow hover:bg-primary/90 hover:!no-underline"
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
                leadTable={lead.source}
                firstName={firstName}
                lastName={lastName}
                phone={phone}
                carrier={carrier}
                city={city}
                state={stateVal}
                zip={zip}
                quotedPremium={lead.quoted_premium}
                currentPremium={lead.current_premium}
                vehicles={vehicles}
                vendorNotes={vendorNotes}
                stopPropagation={false}
                className="inline-flex items-center justify-center gap-2 rounded-md border bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-sm hover:bg-muted transition-colors"
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
              {phone && (
                <TextLeadButton
                  phone={phone}
                  leadId={lead.id}
                  leadTable={lead.source}
                  firstName={firstName}
                  lastName={lastName}
                  carrier={carrier}
                  city={city}
                  state={stateVal}
                  quotedPremium={lead.quoted_premium}
                  currentPremium={lead.current_premium}
                  vehicles={vehicles}
                  stopPropagation={false}
                  className="inline-flex items-center justify-center gap-2 rounded-md border bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-sm hover:bg-muted transition-colors"
                >
                  <MessageSquare className="h-3.5 w-3.5" /> Text
                </TextLeadButton>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 rounded-md border bg-muted/30 p-4 text-sm">
              <div className="space-y-1">
                <Label className="text-xs">Date of birth</Label>
                <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Current carrier</Label>
                <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Carrier" />
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

            <DispoPanelForLead lead={lead} onSaved={onSaved} />
            <div className="space-y-2">
              <Label>Current premium ($) — what they pay today</Label>
              <Input type="number" step="0.01" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>

            <div className="rounded-md border p-4 space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Activity history</div>
              <LeadActivityList leadId={lead.id} leadTable={lead.source} />
            </div>

            <LeadShareSection leadId={lead.id} leadTable={lead.source} claimedBy={lead.claimed_by} uid={uid} />

            <DialogFooter className="sm:justify-between">
              <div />
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button onClick={() => saveM.mutate()} disabled={saveM.isPending}>
                  {saveM.isPending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-foreground">{value}</div>
    </div>
  );
}

function DispoPanelForLead({ lead, onSaved }: { lead: FullLead; onSaved: () => void }) {
  const qc = useQueryClient();
  const housing: HousingStatus = (lead.housing_status as HousingStatus) ?? null;
  // Normalize casing — vendor payloads ship "Auto"/"HOME"/"Both" and the
  // includes() checks below are case-sensitive, which would hide both panes.
  const lt: string[] = (Array.isArray(lead.lead_types) ? lead.lead_types : [])
    .map((s) => String(s).toLowerCase());
  const hasHomeLine = lt.length === 0
    ? true
    : lt.includes("home") || lt.includes("both") || (lead.housing_status === "renter");
  const invalidateKeys: readonly unknown[][] = [
    ["my-leads-live"],
    ["my-leads-list"],
    ["my-leads-shared"],
  ];

  const onHousingChange = async (next: HousingStatus) => {
    const { error } = await (supabase.from(lead.source) as any)
      .update({ housing_status: next })
      .eq("id", lead.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    for (const k of invalidateKeys) qc.invalidateQueries({ queryKey: k });
    onSaved();
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
        source={lead.source}
        housingStatus={housing}
        onHousingChange={onHousingChange}
        home={home}
        showHome={hasHomeLine}
        scriptType={(lead.list_type as ScriptType | null) ?? undefined}
        invalidateKeys={invalidateKeys}
      />
      <LeadExtraLines
        leadId={lead.id}
        source={lead.source}
        invalidateKeys={invalidateKeys}
      />
    </div>
  );
}


function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function FollowUpScheduleDialog({
  lead,
  onClose,
  onConfirm,
}: {
  lead: BoardLead | null;
  onClose: () => void;
  onConfirm: (iso: string) => void;
}) {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (lead) {
      const base = lead.follow_up_at ? new Date(lead.follow_up_at) : (() => {
        const d = new Date();
        d.setHours(d.getHours() + 24, 0, 0, 0);
        return d;
      })();
      setValue(toLocalInputValue(base));
    }
  }, [lead]);
  const open = !!lead;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule follow-up</DialogTitle>
          <DialogDescription>
            Pick a date and time to follow up with this lead. They will appear on your calendar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="follow-up-when">Follow-up at</Label>
          <Input
            id="follow-up-when"
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (!value) return;
              const iso = new Date(value).toISOString();
              onConfirm(iso);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function XDateScheduleDialog({
  lead,
  onClose,
  onConfirm,
}: {
  lead: BoardLead | null;
  onClose: () => void;
  onConfirm: (date: string) => void;
}) {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (lead) {
      const d = new Date();
      d.setMonth(d.getMonth() + 6);
      setValue(d.toISOString().slice(0, 10));
    }
  }, [lead]);
  const open = !!lead;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set X-Date</DialogTitle>
          <DialogDescription>
            Pick the policy renewal date. It will be added to your calendar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="x-date-when">X-Date (policy renewal)</Label>
          <Input
            id="x-date-when"
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => value && onConfirm(value)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NotQuotedReasonDialog({
  lead,
  onClose,
  onConfirm,
}: {
  lead: BoardLead | null;
  onClose: () => void;
  onConfirm: (notes: string) => void;
}) {
  const [reason, setReason] = useState("");
  const existing = lead?.agent_notes?.trim() ?? "";
  useEffect(() => {
    if (lead) setReason("");
  }, [lead]);
  const open = !!lead;
  const canSave = reason.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Why wasn't this lead quoted?</DialogTitle>
          <DialogDescription>
            A reason is required before marking a lead as Not Quoted. This will be appended to the agent notes.
          </DialogDescription>
        </DialogHeader>
        {existing && (
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Existing notes</Label>
            <div className="rounded-md border bg-muted/40 p-2 text-xs whitespace-pre-wrap">{existing}</div>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="not-quoted-reason">Reason <span className="text-destructive">*</span></Label>
          <Textarea
            id="not-quoted-reason"
            rows={4}
            placeholder="e.g. Price too high, vehicle ineligible, lost to competitor…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!canSave}
            onClick={() => {
              const trimmed = reason.trim();
              if (!trimmed) return;
              const stamp = new Date().toLocaleString();
              const entry = `[Not Quoted · ${stamp}] ${trimmed}`;
              const combined = existing ? `${existing}\n\n${entry}` : entry;
              onConfirm(combined);
            }}
          >
            Save reason
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FollowUpCalendarView({
  leads,
  onOpen,
}: {
  leads: BoardLead[];
  onOpen: (lead: BoardLead) => void;
}) {
  const [selected, setSelected] = useState<Date>(() => startOfDay(new Date()));
  const byDay = useMemo(() => {
    const m = new Map<string, BoardLead[]>();
    for (const l of leads) {
      if (!l.follow_up_at) continue;
      const key = format(startOfDay(new Date(l.follow_up_at)), "yyyy-MM-dd");
      const arr = m.get(key) ?? [];
      arr.push(l);
      m.set(key, arr);
    }
    for (const [, arr] of m) {
      arr.sort(
        (a, b) =>
          new Date(a.follow_up_at!).getTime() - new Date(b.follow_up_at!).getTime(),
      );
    }
    return m;
  }, [leads]);

  const markedDays = useMemo(
    () => Array.from(byDay.keys()).map((k) => new Date(k + "T00:00:00")),
    [byDay],
  );

  const dayLeads = byDay.get(format(selected, "yyyy-MM-dd")) ?? [];

  return (
    <Card>
      <CardContent className="grid gap-6 p-4 md:grid-cols-[auto,1fr]">
        <div className="flex justify-center md:justify-start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => d && setSelected(startOfDay(d))}
            modifiers={{ hasFollowUp: markedDays }}
            modifiersClassNames={{
              hasFollowUp:
                "relative after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:h-1 after:w-1 after:rounded-full after:bg-primary",
            }}
            className="pointer-events-auto rounded-md border"
          />
        </div>
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-base font-semibold">
              {format(selected, "EEEE, MMM d, yyyy")}
            </h3>
            <span className="text-xs text-muted-foreground">
              {dayLeads.length} follow-up{dayLeads.length === 1 ? "" : "s"}
            </span>
          </div>
          {dayLeads.length === 0 ? (
            <EmptyCTA
              icon={CalendarDays}
              title="No follow-ups scheduled for this day."
              description="Open a claimed lead and set a callback time to fill your calendar."
              actions={[
                { label: "Open My Board", to: "/my-leads" },
                { label: "Browse Live Leads", to: "/call-queue", variant: "outline" },
              ]}
              size="sm"
            />
          ) : (
            <ul className="space-y-2">
              {dayLeads.map((l) => {
                const at = new Date(l.follow_up_at!);
                const overdue = at.getTime() <= Date.now();
                const name = `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Unnamed";
                return (
                  <li key={`${l.source}:${l.id}`}>
                    <button
                      type="button"
                      onClick={() => onOpen(l)}
                      className="flex w-full items-center justify-between gap-3 rounded-md border bg-background p-3 text-left hover:border-primary/40 hover:shadow-sm transition"
                    >
                       <div className="min-w-0">
                         <div className="truncate text-sm font-semibold">{name}</div>
                         <div className="truncate text-xs text-muted-foreground">
                           <PhoneLink
                             phone={l.phone}
                             className="!text-xs"
                             dnc={l.dispo === "dnc"}
                             leadId={l.id}
                             leadSource={l.source}
                           />
                           {l.current_carrier ? ` · ${l.current_carrier}` : ""}
                         </div>
                       </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium tabular-nums">
                          {format(at, "h:mm a")}
                        </span>
                        {overdue && (
                          <Badge
                            variant="outline"
                            className="bg-rose-100 text-rose-900 border-rose-200"
                          >
                            Overdue
                          </Badge>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
