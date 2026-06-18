import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useHasRole } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CallButton } from "@/components/CallButton";
import { LeadShareSection } from "@/components/LeadShareSection";
import { LeadScoreChip } from "@/components/LeadScoreChip";
import { transferListLead, getSmartCallQueue } from "@/lib/telemarketer.functions";
import { DISPO_OPTIONS, type Dispo, SCRIPT_TYPES, type ScriptType } from "@/lib/constants";
import { LeadSideDispoPanel, type SideState, type HousingStatus } from "@/components/LeadSideDispo";
import { LeadExtraLines } from "@/components/LeadExtraLines";
import { Shield, PhoneCall, ArrowRightCircle, Lock, Sparkles, X, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/call-queue")({
  head: () => ({
    meta: [
      { title: "Call Queue — LeadVault" },
      { name: "description", content: "Shared list-lead call pool for telemarketers." },
    ],
  }),
  component: CallQueuePage,
});

type Row = {
  id: string;
  vendor_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  current_carrier: string | null;
  dispo: Dispo | null;
  agent_notes: string | null;
  follow_up_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  transferred_at: string | null;
  transferred_lead_id: string | null;
  created_at: string;
  list_type: string | null;
  list_type_priority?: number | null;
  call_count?: number;
  last_called_at?: string | null;
  composite_score?: number | null;
  score_tier?: "S" | "A" | "B" | "C" | null;
};

function CallQueuePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const isTelemarketer = useHasRole("telemarketer");
  const isAdmin = useHasRole("admin");

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

  return (
    <AppShell>
      {!(isTelemarketer || isAdmin) ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Telemarketer access required.
          </CardContent>
        </Card>
      ) : (
        <Queue uid={user.id} />
      )}
    </AppShell>
  );
}

function Queue({ uid }: { uid: string }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<"available" | "mine" | "transferred">("available");
  const [search, setSearch] = useState("");
  const [viewingId, setViewingId] = useState<string | null>(null);

  const transferFn = useServerFn(transferListLead);
  const smartQueueFn = useServerFn(getSmartCallQueue);

  const rowsQ = useQuery({
    queryKey: ["call-queue", scope, search, uid],
    queryFn: async () => {
      if (scope === "available") {
        const data = await smartQueueFn({ data: { search, limit: 150 } });
        return (data as unknown as Row[]) ?? [];
      }
      let q = supabase
        .from("list_leads")
        .select(
          "id, vendor_id, first_name, last_name, phone, city, state, current_carrier, dispo, agent_notes, follow_up_at, claimed_by, claimed_at, transferred_at, transferred_lead_id, list_type, created_at, composite_score, score_tier",
        )
        .is("archived_at", null)
        .order("composite_score", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(200);
      if (scope === "mine") {
        q = q.eq("claimed_by", uid).is("transferred_lead_id", null);
      } else {
        q = q.eq("transferred_by" as never, uid as never).not("transferred_lead_id", "is", null);
      }
      const s = search.trim();
      if (s) {
        const safe = s.replace(/[%(),"']/g, " ").trim();
        if (safe) {
          const words = safe.split(/\s+/).filter(Boolean);
          const parts: string[] = [
            `first_name.ilike.%${safe}%`,
            `last_name.ilike.%${safe}%`,
            `phone.ilike.%${safe}%`,
            `city.ilike.%${safe}%`,
            `state.ilike.%${safe}%`,
          ];
          if (words.length >= 2) {
            const w1 = words[0];
            const w2 = words[1];
            parts.push(
              `and(first_name.ilike.%${w1}%,last_name.ilike.%${w2}%)`,
              `and(first_name.ilike.%${w2}%,last_name.ilike.%${w1}%)`,
            );
            // Fuzzy fallback: surface leads where only one name part matches
            // (correct last name with wrong first name, or vice versa).
            for (const w of words) {
              if (w.length >= 2) {
                parts.push(
                  `first_name.ilike.%${w}%`,
                  `last_name.ilike.%${w}%`,
                );
              }
            }
          }
          // Format-tolerant phone search (handles "3054015824" vs "(305) 401-5824").
          const digits = s.replace(/\D/g, "");
          if (digits.length >= 4) {
            parts.push(`phone.ilike.%${digits.split("").join("%")}%`);
          }
          // Fuzzy (typo / nickname) suggestions via pg_trgm RPC.
          if (/[a-zA-Z]{2,}/.test(s)) {
            const { data: fuzzy } = await supabase.rpc("fuzzy_list_lead_ids", {
              q: s,
              lim: 50,
            });
            const fuzzyIds = ((fuzzy as Array<{ id: string }> | null) ?? [])
              .map((r) => r.id);
            if (fuzzyIds.length > 0) {
              parts.push(`id.in.(${fuzzyIds.join(",")})`);
            }
          }
          q = q.or(parts.join(","));
        }
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as Row[]) ?? [];
    },
  });

  const claimM = useMutation({
    mutationFn: async ({ id, claim }: { id: string; claim: boolean }) => {
      if (claim) {
        const { error } = await (supabase as any).rpc("claim_list_lead", { p_id: id });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("list_leads")
          .update({ claimed_by: null, claimed_at: null } as never)
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: (_d, v) => {
      toast.success(v.claim ? "Lead claimed" : "Released");
      qc.invalidateQueries({ queryKey: ["call-queue"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const transferM = useMutation({
    mutationFn: (id: string) => transferFn({ data: { list_lead_id: id } }),
    onSuccess: () => {
      toast.success("Transferred to Live Leads");
      qc.invalidateQueries({ queryKey: ["call-queue"] });
      setViewingId(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Transfer failed"),
  });

  const rows = rowsQ.data ?? [];

  return (
    <>
      <PageHeader
        title="Call Queue"
        description={
          scope === "available"
            ? "Smart-ranked pool: never-called leads first, then by priority, age, and call cooldown."
            : "Shared list-lead pool. Claim a lead, call, log the outcome, then transfer warm leads to Live Leads."
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border bg-muted p-1">
              {[
                { v: "available", label: "Available" },
                { v: "mine", label: "My claimed" },
                { v: "transferred", label: "My transfers" },
              ].map((opt) => (
                <button
                  key={opt.v}
                  onClick={() => setScope(opt.v as typeof scope)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    scope === opt.v
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <Card>
        <CardContent className="p-0">
          {rowsQ.isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              {scope === "available"
                ? "No available leads in the queue right now."
                : scope === "mine"
                  ? "You haven't claimed any leads yet. Switch to Available to grab one."
                  : "You haven't transferred any leads yet."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>List type</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const mine = r.claimed_by === uid;
                  const otherClaimed = !!r.claimed_by && !mine;
                  const transferred = !!r.transferred_lead_id;
                  return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => setViewingId(r.id)}
                    >
                      <TableCell className="text-right">
                        <LeadScoreChip score={r.composite_score} tier={r.score_tier} size="xs" />
                      </TableCell>
                      <TableCell className="font-medium">
                        <span className="underline-offset-2 hover:underline">
                          {r.first_name} {r.last_name}
                        </span>
                        {scope === "available" && (r.call_count ?? 0) === 0 && (
                          <Badge variant="secondary" className="ml-2 gap-1">
                            <Sparkles className="h-3 w-3" /> Fresh
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {r.phone ? (
                          <div className="flex flex-col items-start gap-1">
                            <CallButton
                              leadId={r.id}
                              leadTable="list_leads"
                              phone={r.phone}
                              uid={uid}
                              dnc={r.dispo === "dnc"}
                            />
                          </div>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {r.list_type ? (
                          <Badge variant="outline" className="capitalize">
                            {r.list_type.replace(/_/g, " ")}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        {typeof r.call_count === "number" && r.call_count > 0 && (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {r.call_count} prior call{r.call_count === 1 ? "" : "s"}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {[r.city, r.state].filter(Boolean).join(", ") || "—"}
                      </TableCell>
                      <TableCell className="text-sm">{r.current_carrier || "—"}</TableCell>
                      <TableCell>
                        {transferred ? (
                          <Badge variant="secondary">Transferred</Badge>
                        ) : mine ? (
                          <Badge>Mine</Badge>
                        ) : otherClaimed ? (
                          <Badge variant="outline" className="gap-1">
                            <Lock className="h-3 w-3" /> Claimed
                          </Badge>
                        ) : (
                          <Badge variant="outline">Open</Badge>
                        )}
                        {r.dispo && (
                          <Badge variant="outline" className="ml-1 capitalize">
                            {r.dispo.replace(/_/g, " ")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        {transferred ? (
                          <span className="text-xs text-muted-foreground">Done</span>
                        ) : (
                          <div className="flex justify-end gap-2">
                            {!r.claimed_by ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={claimM.isPending}
                                onClick={() => claimM.mutate({ id: r.id, claim: true })}
                              >
                                <PhoneCall className="h-4 w-4" /> Claim
                              </Button>
                            ) : mine ? (
                              <Button
                                size="sm"
                                disabled={transferM.isPending}
                                onClick={() => transferM.mutate(r.id)}
                              >
                                <ArrowRightCircle className="h-4 w-4" /> Transfer
                              </Button>
                            ) : (
                              <Badge variant="outline" className="gap-1">
                                <Lock className="h-3 w-3" /> Locked
                              </Badge>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {viewingId && (
        <DetailsDialog
          leadId={viewingId}
          uid={uid}
          onClose={() => setViewingId(null)}
          onTransfer={(id) => transferM.mutate(id)}
          isTransferring={transferM.isPending}
        />
      )}
    </>
  );
}

type FullLead = Record<string, unknown> & {
  id: string;
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
  current_home_carrier: string | null;
  list_type: string | null;
  lead_type: string | null;
  num_vehicles: number | null;
  vehicles: unknown;
  vendor_notes: string | null;
  agent_notes: string | null;
  dispo: Dispo | null;
  follow_up_at: string | null;
  claimed_by: string | null;
  transferred_lead_id: string | null;
  year_built: number | null;
  square_feet: number | null;
  construction_type: string | null;
  roof_type: string | null;
  roof_year: number | null;
  num_stories: number | null;
  num_bedrooms: number | null;
  num_bathrooms: number | null;
  dwelling_value: number | null;
  has_pool: boolean | null;
  has_trampoline: boolean | null;
  claims_last_5y: number | null;
  mortgage_company: string | null;
  created_at: string;
};

function EditField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string | number | null | undefined;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Input
        type={type}
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

type Vehicle = { year?: string; make?: string; model?: string; vin?: string };

function DetailsDialog({
  leadId,
  uid,
  onClose,
  onTransfer,
  isTransferring,
}: {
  leadId: string;
  uid: string;
  onClose: () => void;
  onTransfer: (id: string) => void;
  isTransferring: boolean;
}) {
  const qc = useQueryClient();

  const leadQ = useQuery({
    queryKey: ["call-queue-detail", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("list_leads")
        .select("agent_id,agent_notes,archived_at,auto_motor_club_premium,auto_policies_count,auto_sale_type,auto_score,billable_override,city,claimed_at,claimed_by,claims_last_5y,composite_score,construction_type,county,created_at,current_carrier,current_home_carrier,current_premium,date_of_birth,dispo,dwelling_value,email,first_name,follow_up_at,has_pool,has_trampoline,home_agent_notes,home_claimed_at,home_claimed_by,home_dispo,home_follow_up_at,home_policies_count,home_quoted_premium,home_sale_type,home_score,home_x_date,housing_status,id,import_batch_id,last_name,lead_source,lead_type,lead_types,list_type,list_type_priority,litigator,mortgage_company,not_billable,num_bathrooms,num_bedrooms,num_stories,num_vehicles,phone,quoted_premium,referred_by,roof_type,roof_year,score_breakdown,score_tier,scored_at,source_row,square_feet,state,street,transferred_at,transferred_by,transferred_lead_id,updated_at,vehicles,vendor_id,vendor_notes,x_date,year_built,zip")
        .eq("id", leadId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as FullLead | null;
    },
  });
  const lead = leadQ.data;

  const [form, setForm] = useState<Record<string, string>>({});
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (lead && !hydrated) {
      const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
      setForm({
        first_name: s(lead.first_name),
        last_name: s(lead.last_name),
        phone: s(lead.phone),
        email: s(lead.email),
        date_of_birth: s(lead.date_of_birth),
        current_carrier: s(lead.current_carrier),
        street: s(lead.street),
        city: s(lead.city),
        state: s(lead.state),
        zip: s(lead.zip),
        county: s(lead.county),
        current_home_carrier: s(lead.current_home_carrier),
        year_built: s(lead.year_built),
        square_feet: s(lead.square_feet),
        construction_type: s(lead.construction_type),
        roof_type: s(lead.roof_type),
        roof_year: s(lead.roof_year),
        num_stories: s(lead.num_stories),
        num_bedrooms: s(lead.num_bedrooms),
        num_bathrooms: s(lead.num_bathrooms),
        dwelling_value: s(lead.dwelling_value),
        claims_last_5y: s(lead.claims_last_5y),
        mortgage_company: s(lead.mortgage_company),
        vendor_notes: s(lead.vendor_notes),
        dispo: s(lead.dispo),
        agent_notes: s(lead.agent_notes),
        follow_up_at: lead.follow_up_at ? lead.follow_up_at.slice(0, 16) : "",
      });
      const vArr = Array.isArray(lead.vehicles) ? (lead.vehicles as unknown[]) : [];
      setVehicles(
        vArr.map((v) => {
          const veh = (v ?? {}) as Record<string, unknown>;
          return {
            year: veh.year == null ? "" : String(veh.year),
            make: veh.make == null ? "" : String(veh.make),
            model: veh.model == null ? "" : String(veh.model),
            vin: veh.vin == null ? "" : String(veh.vin),
          };
        }),
      );
      setHydrated(true);
    }
  }, [lead, hydrated]);

  const setField = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const updateVehicle = (i: number, patch: Partial<Vehicle>) =>
    setVehicles((vs) => vs.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  const addVehicle = () => setVehicles((vs) => [...vs, { year: "", make: "", model: "", vin: "" }]);
  const removeVehicle = (i: number) => setVehicles((vs) => vs.filter((_, idx) => idx !== i));

  const mine = !!lead && lead.claimed_by === uid;
  const transferred = !!lead?.transferred_lead_id;

  const claimM = useMutation({
    mutationFn: async (claim: boolean) => {
      if (claim) {
        const { error } = await (supabase as any).rpc("claim_list_lead", { p_id: leadId });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("list_leads")
          .update({ claimed_by: null, claimed_at: null } as never)
          .eq("id", leadId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["call-queue"] });
      qc.invalidateQueries({ queryKey: ["call-queue-detail", leadId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const saveM = useMutation({
    mutationFn: async () => {
      const numOrNull = (v: string) => {
        const t = v.trim();
        if (!t) return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
      };
      const strOrNull = (v: string) => (v.trim() === "" ? null : v.trim());
      const cleanedVehicles = vehicles
        .filter((v) => v.year || v.make || v.model || v.vin)
        .map((v) => ({
          year: v.year ? Number(v.year) || v.year : null,
          make: v.make || null,
          model: v.model || null,
          vin: v.vin || null,
        }));
      const { error } = await supabase
        .from("list_leads")
        .update({
          first_name: strOrNull(form.first_name ?? ""),
          last_name: strOrNull(form.last_name ?? ""),
          phone: strOrNull(form.phone ?? ""),
          email: strOrNull(form.email ?? ""),
          date_of_birth: strOrNull(form.date_of_birth ?? ""),
          current_carrier: strOrNull(form.current_carrier ?? ""),
          street: strOrNull(form.street ?? ""),
          city: strOrNull(form.city ?? ""),
          state: strOrNull(form.state ?? ""),
          zip: strOrNull(form.zip ?? ""),
          county: strOrNull(form.county ?? ""),
          current_home_carrier: strOrNull(form.current_home_carrier ?? ""),
          year_built: numOrNull(form.year_built ?? ""),
          square_feet: numOrNull(form.square_feet ?? ""),
          construction_type: strOrNull(form.construction_type ?? ""),
          roof_type: strOrNull(form.roof_type ?? ""),
          roof_year: numOrNull(form.roof_year ?? ""),
          num_stories: numOrNull(form.num_stories ?? ""),
          num_bedrooms: numOrNull(form.num_bedrooms ?? ""),
          num_bathrooms: numOrNull(form.num_bathrooms ?? ""),
          dwelling_value: numOrNull(form.dwelling_value ?? ""),
          claims_last_5y: numOrNull(form.claims_last_5y ?? ""),
          mortgage_company: strOrNull(form.mortgage_company ?? ""),
          vehicles: cleanedVehicles,
          num_vehicles: cleanedVehicles.length || null,
        } as never)
        .eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["call-queue"] });
      qc.invalidateQueries({ queryKey: ["call-queue-detail", leadId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-lg bg-background shadow-lg sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-background/95 px-6 py-4 backdrop-blur">
          <div>
            <h3 className="text-lg font-semibold">
              {lead ? `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Lead" : "Loading…"}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {lead?.list_type && (
                <Badge variant="outline" className="capitalize">
                  {lead.list_type.replace(/_/g, " ")}
                </Badge>
              )}
              {lead?.lead_type && (
                <Badge variant="secondary" className="capitalize">
                  {lead.lead_type}
                </Badge>
              )}
              {transferred && <Badge>Transferred</Badge>}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {!lead ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <fieldset disabled={!mine || transferred} className="space-y-6 p-6 disabled:opacity-70">
            {!mine && !transferred && (
              <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                Claim this lead to edit details, log a disposition, or transfer it.
              </p>
            )}

            <section>
              <h4 className="mb-3 text-sm font-semibold">Contact</h4>
              <div className="grid grid-cols-2 gap-4">
                <EditField label="First name" value={form.first_name} onChange={(v) => setField("first_name", v)} />
                <EditField label="Last name" value={form.last_name} onChange={(v) => setField("last_name", v)} />
                <EditField label="Phone" value={form.phone} onChange={(v) => setField("phone", v)} />
                <EditField label="Email" value={form.email} onChange={(v) => setField("email", v)} type="email" />
                <EditField label="Date of birth" value={form.date_of_birth} onChange={(v) => setField("date_of_birth", v)} type="date" />
                <EditField label="Current auto carrier" value={form.current_carrier} onChange={(v) => setField("current_carrier", v)} />
              </div>
            </section>

            <section>
              <h4 className="mb-3 text-sm font-semibold">Address</h4>
              <div className="grid grid-cols-2 gap-4">
                <EditField label="Street" value={form.street} onChange={(v) => setField("street", v)} />
                <EditField label="City" value={form.city} onChange={(v) => setField("city", v)} />
                <EditField label="State" value={form.state} onChange={(v) => setField("state", v)} />
                <EditField label="Zip" value={form.zip} onChange={(v) => setField("zip", v)} />
                <EditField label="County" value={form.county} onChange={(v) => setField("county", v)} />
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-semibold">Vehicles ({vehicles.length})</h4>
                <Button type="button" size="sm" variant="outline" onClick={addVehicle}>
                  <Plus className="h-4 w-4" /> Add vehicle
                </Button>
              </div>
              {vehicles.length === 0 ? (
                <p className="text-xs text-muted-foreground">No vehicles on file.</p>
              ) : (
                <div className="space-y-3">
                  {vehicles.map((v, i) => (
                    <div key={i} className="rounded-md border bg-muted/30 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-xs font-medium text-muted-foreground">Vehicle {i + 1}</div>
                        <Button type="button" size="sm" variant="ghost" onClick={() => removeVehicle(i)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <EditField label="Year" value={v.year ?? ""} onChange={(val) => updateVehicle(i, { year: val })} />
                        <EditField label="Make" value={v.make ?? ""} onChange={(val) => updateVehicle(i, { make: val })} />
                        <EditField label="Model" value={v.model ?? ""} onChange={(val) => updateVehicle(i, { model: val })} />
                        <EditField label="VIN" value={v.vin ?? ""} onChange={(val) => updateVehicle(i, { vin: val })} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h4 className="mb-3 text-sm font-semibold">Home</h4>
              <div className="grid grid-cols-2 gap-4">
                <EditField label="Current home carrier" value={form.current_home_carrier} onChange={(v) => setField("current_home_carrier", v)} />
                <EditField label="Year built" value={form.year_built} onChange={(v) => setField("year_built", v)} type="number" />
                <EditField label="Square feet" value={form.square_feet} onChange={(v) => setField("square_feet", v)} type="number" />
                <EditField label="Construction" value={form.construction_type} onChange={(v) => setField("construction_type", v)} />
                <EditField label="Roof" value={form.roof_type} onChange={(v) => setField("roof_type", v)} />
                <EditField label="Roof year" value={form.roof_year} onChange={(v) => setField("roof_year", v)} type="number" />
                <EditField label="Stories" value={form.num_stories} onChange={(v) => setField("num_stories", v)} type="number" />
                <EditField label="Bedrooms" value={form.num_bedrooms} onChange={(v) => setField("num_bedrooms", v)} type="number" />
                <EditField label="Bathrooms" value={form.num_bathrooms} onChange={(v) => setField("num_bathrooms", v)} type="number" />
                <EditField label="Dwelling value" value={form.dwelling_value} onChange={(v) => setField("dwelling_value", v)} type="number" />
                <EditField label="Claims (5y)" value={form.claims_last_5y} onChange={(v) => setField("claims_last_5y", v)} type="number" />
                <EditField label="Mortgage" value={form.mortgage_company} onChange={(v) => setField("mortgage_company", v)} />
              </div>
            </section>

            {form.vendor_notes && (
              <section>
                <h4 className="mb-2 text-sm font-semibold">Vendor notes</h4>
                <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">
                  {form.vendor_notes}
                </p>
              </section>
            )}

            <section className="space-y-3 rounded-lg border p-4">
              <h4 className="text-sm font-semibold">Call outcome</h4>
              {lead && <CallQueueDispoPanel lead={lead} />}
            </section>

            <LeadShareSection
              leadId={leadId}
              leadTable="list_leads"
              claimedBy={lead?.claimed_by ?? null}
              uid={uid}
            />
          </fieldset>
        )}

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t bg-background/95 px-6 py-3 backdrop-blur">
          {mine && !transferred ? (
            <Button
              variant="ghost"
              onClick={() => claimM.mutate(false)}
              disabled={claimM.isPending}
            >
              Release
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            {!transferred && !lead?.claimed_by && (
              <Button
                variant="secondary"
                onClick={() => claimM.mutate(true)}
                disabled={claimM.isPending || !lead}
              >
                <PhoneCall className="h-4 w-4" /> Claim
              </Button>
            )}
            {mine && !transferred && (
              <>
                <Button onClick={() => saveM.mutate()} disabled={saveM.isPending}>
                  Save changes
                </Button>
                <Button
                  onClick={() => onTransfer(leadId)}
                  disabled={isTransferring}
                >
                  <ArrowRightCircle className="h-4 w-4" /> Transfer
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
function CallQueueDispoPanel({ lead }: { lead: FullLead }) {
  const qc = useQueryClient();
  const l = lead as unknown as Record<string, unknown>;
  const housing: HousingStatus =
    (l.housing_status as HousingStatus | undefined) ?? null;
  const ltRaw = l.lead_types;
  // Normalize casing — vendor payloads ship "Auto"/"HOME"/"Both" and the
  // includes() checks below are case-sensitive, which would hide both panes.
  const lt: string[] = (Array.isArray(ltRaw) ? (ltRaw as string[]) : [])
    .map((s) => String(s).toLowerCase());
  const hasHomeLine = lt.length === 0
    ? true
    : lt.includes("home") || lt.includes("both") || housing === "renter";
  const invalidateKeys: readonly unknown[][] = [
    ["call-queue"],
    ["call-queue-detail", lead.id],
  ];

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
    dispo: (l.home_dispo as Dispo | null) ?? null,
    claimed_by: (l.home_claimed_by as string | null) ?? null,
    quoted_premium: (l.home_quoted_premium as number | null) ?? null,
    policies_count: (l.home_policies_count as number | null) ?? 0,
    follow_up_at: (l.home_follow_up_at as string | null) ?? null,
    x_date: (l.home_x_date as string | null) ?? null,
    agent_notes: (l.home_agent_notes as string | null) ?? null,
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
