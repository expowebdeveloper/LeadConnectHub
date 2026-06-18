import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth, useHasRole } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listBillingVendors,
  getVendorBilling,
  updateBillingLead,
  getLeadActivities,
  type BillingLead,
} from "@/lib/billing.functions";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { PhoneLink } from "@/components/PhoneLink";

export const Route = createFileRoute("/billing")({
  head: () => ({
    meta: [
      { title: "Billable Leads — LeadVault" },
      { name: "description", content: "Vendor billing and amounts owed." },
    ],
  }),
  component: BillingPage,
});

function BillingPage() {
  const { user, loading } = useAuth();
  const isAdmin = useHasRole("admin");
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  if (loading || !user) return null;

  return (
    <AppShell>
      <PageHeader
        title="Billable Leads"
        description="Review every lead a vendor submitted and compute what they're owed."
      />
      {!isAdmin ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Admin access required.
          </CardContent>
        </Card>
      ) : (
        <BillingPanel />
      )}
    </AppShell>
  );
}

function isOneCarVendor(name?: string | null): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return n.includes("nadir") || n.includes("giga") || n.includes("sm connect");
}

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

type VendorMeta = {
  name: string;
  default_lead_rate: number | null;
  min_vehicles: number | null;
  max_age: number | null;
};

function billableInfo(lead: BillingLead, vendor: VendorMeta): { billable: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const positiveDispos = new Set(["sold", "quoted", "follow_up", "x_date"]);
  const hasPositiveDispo = lead.dispo ? positiveDispos.has(lead.dispo) : false;
  if (lead.billable_override === true) {
    return { billable: true, reasons: ["Admin override: forced billable."] };
  }
  if (lead.billable_override === false) {
    return { billable: false, reasons: ["Admin override: forced not billable."] };
  }
  if (lead.source === "list" && lead.not_billable) reasons.push("Marked not billable.");
  if (lead.dispo === "already_has_allstate") reasons.push("Has Allstate.");
  if (lead.dispo === "voicemail") reasons.push("Left voicemail.");
  if (!lead.claimed_by && !hasPositiveDispo) {
    reasons.push("Lead was not answered/quoted.");
  } else if (lead.dispo === "not_quoted") {
    reasons.push("Lead was not quoted.");
  }
  const minVehicles = vendor.min_vehicles ?? (isOneCarVendor(vendor.name) ? 1 : 2);
  const maxAge = vendor.max_age ?? 70;
  if ((lead.num_vehicles ?? 0) < minVehicles) {
    reasons.push(`Vehicles ${lead.num_vehicles ?? 0} < required ${minVehicles}.`);
  }
  const age = ageFromDob(lead.date_of_birth);
  if (age != null && age > maxAge) reasons.push(`Age ${age} > max ${maxAge}.`);
  const carrierNorm = (lead.current_carrier ?? "").trim().toLowerCase();
  const homeCarrierNorm = (lead.current_home_carrier ?? "").trim().toLowerCase();
  if (carrierNorm.includes("allstate") || homeCarrierNorm.includes("allstate")) reasons.push("Already has Allstate.");
  return { billable: reasons.length === 0, reasons };
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function BillingPanel() {
  const fetchVendors = useServerFn(listBillingVendors);
  const fetchBilling = useServerFn(getVendorBilling);

  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState<string>(firstOfMonth.toISOString().slice(0, 10));
  const [to, setTo] = useState<string>("");
  const [vendorId, setVendorId] = useState<string>("");
  const [filter, setFilter] = useState<"all" | "billable" | "not_billable">("all");
  const [selectedLead, setSelectedLead] = useState<
    (BillingLead & { billable: boolean; reasons: string[]; payout: number }) | null
  >(null);

  const vendorsQ = useQuery({
    queryKey: ["billing-vendors"],
    queryFn: () => fetchVendors(),
  });

  const selectedVendor = useMemo(
    () => (vendorsQ.data ?? []).find((v) => v.id === vendorId),
    [vendorsQ.data, vendorId],
  );

  const billingQ = useQuery({
    queryKey: ["billing-vendor", vendorId, from, to],
    queryFn: () =>
      fetchBilling({
        data: {
          vendor_id: vendorId,
          vendor_ids: selectedVendor?.ids,
          from: from ? new Date(from).toISOString() : undefined,
          to: to ? new Date(new Date(to).setHours(23, 59, 59, 999)).toISOString() : undefined,
        },
      }),
    enabled: !!vendorId,
  });

  const allLeads: BillingLead[] = useMemo(
    () => [...(billingQ.data?.live ?? []), ...(billingQ.data?.list ?? [])],
    [billingQ.data],
  );

  const vendorMeta: VendorMeta | null = billingQ.data?.vendor
    ? {
        name: billingQ.data.vendor.name,
        default_lead_rate: billingQ.data.vendor.default_lead_rate,
        min_vehicles: billingQ.data.vendor.min_vehicles,
        max_age: billingQ.data.vendor.max_age,
      }
    : null;

  const enriched = useMemo(() => {
    if (!vendorMeta) return [];
    return allLeads.map((l) => {
      const info = billableInfo(l, vendorMeta);
      const payout =
        l.vendor_payout != null && l.vendor_payout > 0
          ? l.vendor_payout
          : vendorMeta.default_lead_rate ?? 0;
      return { ...l, ...info, payout };
    });
  }, [allLeads, vendorMeta]);

  const visible = useMemo(() => {
    if (filter === "billable") return enriched.filter((l) => l.billable);
    if (filter === "not_billable") return enriched.filter((l) => !l.billable);
    return enriched;
  }, [enriched, filter]);

  const totals = useMemo(() => {
    const billable = enriched.filter((l) => l.billable);
    const owed = billable.reduce((s, l) => s + (l.payout ?? 0), 0);
    return {
      total: enriched.length,
      billable: billable.length,
      notBillable: enriched.length - billable.length,
      owed,
    };
  }, [enriched]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label>Vendor</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a vendor" />
              </SelectTrigger>
              <SelectContent>
                {(vendorsQ.data ?? []).map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                    {v.default_lead_rate != null ? ` · ${fmtMoney(v.default_lead_rate)}/lead` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="from">From</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to">To</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Show</Label>
            <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All leads</SelectItem>
                <SelectItem value="billable">Billable only</SelectItem>
                <SelectItem value="not_billable">Not billable only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!vendorId ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Pick a vendor to see their leads and the amount owed.
          </CardContent>
        </Card>
      ) : billingQ.isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent>
        </Card>
      ) : billingQ.error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            {(billingQ.error as Error).message}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <StatCard label="Total leads" value={totals.total.toString()} />
            <StatCard label="Billable" value={totals.billable.toString()} />
            <StatCard label="Not billable" value={totals.notBillable.toString()} />
            <StatCard label="Amount owed" value={fmtMoney(totals.owed)} highlight />
          </div>

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Dispo</TableHead>
                    <TableHead>Vehicles</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Payout</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((l) => {
                    const age = ageFromDob(l.date_of_birth);
                    return (
                      <TableRow
                        key={`${l.source}-${l.id}`}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedLead(l)}
                      >
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(l.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="font-medium">
                          {(l.first_name ?? "") + " " + (l.last_name ?? "")}
                        </TableCell>
                        <TableCell className="text-xs"><PhoneLink phone={l.phone} dnc={l.dispo === "dnc"} leadId={l.id} leadSource={l.source} /></TableCell>
                        <TableCell className="text-xs">
                          {l.source === "live" ? "Live" : l.list_type || "List"}
                        </TableCell>
                        <TableCell className="text-xs">{l.dispo ?? "—"}</TableCell>
                        <TableCell className="text-xs">{l.num_vehicles ?? 0}</TableCell>
                        <TableCell className="text-xs">{age ?? "—"}</TableCell>
                        <TableCell>
                          {l.billable ? (
                            <Badge>Billable</Badge>
                          ) : (
                            <span title={l.reasons.join(" ")}>
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Not billable</Badge>
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {l.billable ? fmtMoney(l.payout ?? 0) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {visible.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground py-6">
                        No leads for this filter.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <LeadDetailsSheet
        lead={selectedLead}
        vendorName={vendorMeta?.name ?? ""}
        onClose={() => setSelectedLead(null)}
        queryKey={["billing-vendor", vendorId, from, to]}
      />
    </div>
  );
}

function LeadDetailsSheet({
  lead,
  vendorName,
  onClose,
  queryKey,
}: {
  lead:
    | (BillingLead & { billable: boolean; reasons: string[]; payout: number })
    | null;
  vendorName: string;
  onClose: () => void;
  queryKey: unknown[];
}) {
  const age = lead ? ageFromDob(lead.date_of_birth) : null;
  const qc = useQueryClient();
  const saveFn = useServerFn(updateBillingLead);

  const [dispo, setDispo] = useState<string>("");
  const [vehicles, setVehicles] = useState<string>("");
  const [payout, setPayout] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [notBillable, setNotBillable] = useState<boolean>(false);
  const [override, setOverride] = useState<"auto" | "force_billable" | "force_not_billable">("auto");

  useEffect(() => {
    if (!lead) return;
    setDispo(lead.dispo ?? "");
    setVehicles(String(lead.num_vehicles ?? 0));
    setPayout(lead.vendor_payout != null ? String(lead.vendor_payout) : "");
    setNotes(lead.agent_notes ?? "");
    setNotBillable(!!lead.not_billable);
    setOverride(
      lead.billable_override === true
        ? "force_billable"
        : lead.billable_override === false
          ? "force_not_billable"
          : "auto",
    );
  }, [lead]);

  const mut = useMutation({
    mutationFn: async () => {
      if (!lead) return;
      const vehiclesNum = vehicles.trim() === "" ? null : Number(vehicles);
      const payoutNum = payout.trim() === "" ? null : Number(payout);
      if (vehiclesNum != null && !Number.isFinite(vehiclesNum)) {
        throw new Error("Vehicles must be a number");
      }
      if (payoutNum != null && !Number.isFinite(payoutNum)) {
        throw new Error("Payout must be a number");
      }
      await saveFn({
        data: {
          id: lead.id,
          source: lead.source,
          dispo: (dispo || null) as never,
          num_vehicles: vehiclesNum,
          vendor_payout: payoutNum,
          agent_notes: notes.trim() === "" ? null : notes,
          billable_override:
            override === "force_billable"
              ? true
              : override === "force_not_billable"
                ? false
                : null,
          ...(lead.source === "list" ? { not_billable: notBillable } : {}),
        },
      });
    },
    onSuccess: () => {
      toast.success("Lead updated");
      qc.invalidateQueries({ queryKey });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activitiesQ = useQuery({
    queryKey: ["lead-activities", lead?.source, lead?.id],
    queryFn: () =>
      getLeadActivities({ data: { lead_id: lead!.id, source: lead!.source } }),
    enabled: !!lead,
  });

  const dispoOptions = [
    "sold",
    "quoted",
    "not_quoted",
    "voicemail",
    "follow_up",
    "x_date",
    "wrong_number",
    "dead",
  ];
  return (
    <Sheet open={!!lead} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        {lead && (
          <>
            <SheetHeader>
              <SheetTitle>
                {(lead.first_name ?? "") + " " + (lead.last_name ?? "")}
              </SheetTitle>
              <SheetDescription>
                {vendorName} ·{" "}
                {lead.source === "live" ? "Live lead" : lead.list_type || "List lead"}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-4 text-sm">
              <div className="flex items-center gap-2">
                {lead.billable ? (
                  <Badge>Billable · {fmtMoney(lead.payout ?? 0)}</Badge>
                ) : (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Not billable</Badge>
                )}
              </div>
              {!lead.billable && lead.reasons.length > 0 && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
                  <div className="font-medium mb-1">Why not billable</div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {lead.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Phone"
                  value={<PhoneLink phone={lead.phone} stopPropagation={false} dnc={lead.dispo === "dnc"} />}
                />
                <Field label="Date of birth" value={lead.date_of_birth ?? "—"} />
                <Field label="Age" value={age != null ? String(age) : "—"} />
                <Field
                  label="Created"
                  value={new Date(lead.created_at).toLocaleString()}
                />
                <Field label="Claimed" value={lead.claimed_by ? "Yes" : "No"} />
                <Field label="Lead ID" value={lead.id} />
                <Field
                  label="Quoted premium"
                  value={lead.quoted_premium != null ? fmtMoney(lead.quoted_premium) : "—"}
                />
              </div>

              <div className="border-t pt-4 space-y-3">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Edit
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Dispo</Label>
                    <Select value={dispo || "__none"} onValueChange={(v) => setDispo(v === "__none" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">—</SelectItem>
                        {dispoOptions.map((d) => (
                          <SelectItem key={d} value={d}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bv">Vehicles</Label>
                    <Input
                      id="bv"
                      type="number"
                      min={0}
                      max={20}
                      value={vehicles}
                      onChange={(e) => setVehicles(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label htmlFor="bp">Vendor payout ($)</Label>
                    <Input
                      id="bp"
                      type="number"
                      min={0}
                      step="0.01"
                      value={payout}
                      onChange={(e) => setPayout(e.target.value)}
                      placeholder="Defaults to vendor rate"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bn">Agent notes</Label>
                  <Textarea
                    id="bn"
                    rows={4}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
                {lead.source === "list" && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={notBillable}
                      onCheckedChange={(c) => setNotBillable(c === true)}
                    />
                    Mark not billable
                  </label>
                )}
                <div className="space-y-1">
                  <Label>Admin billable override</Label>
                  <Select value={override} onValueChange={(v) => setOverride(v as typeof override)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (use rules)</SelectItem>
                      <SelectItem value="force_billable">Force billable</SelectItem>
                      <SelectItem value="force_not_billable">Force not billable</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Overrides all rules (vehicles, age, claimed, dispo, etc.).
                  </p>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
                    Cancel
                  </Button>
                  <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
                    {mut.isPending ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </div>

              <div className="border-t pt-4 space-y-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  History
                </div>
                {activitiesQ.isLoading ? (
                  <div className="text-xs text-muted-foreground">Loading…</div>
                ) : (activitiesQ.data ?? []).length === 0 ? (
                  <div className="text-xs text-muted-foreground">No activity yet.</div>
                ) : (
                  <ol className="space-y-2">
                    {(activitiesQ.data ?? []).map((a) => {
                      let detailsObj: Record<string, unknown> = {};
                      try {
                        detailsObj = JSON.parse(a.details) ?? {};
                      } catch {
                        detailsObj = {};
                      }
                      return (
                        <li key={a.id} className="rounded-md border p-2 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">
                              {formatActivityAction(a.action)}
                            </span>
                            <span className="text-muted-foreground">
                              {new Date(a.created_at).toLocaleString()}
                            </span>
                          </div>
                          <div className="text-muted-foreground">
                            by {a.user_name}
                            {formatActivityDetails(a.action, detailsObj) && (
                              <> · {formatActivityDetails(a.action, detailsObj)}</>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function formatActivityAction(action: string): string {
  const map: Record<string, string> = {
    claimed: "Claimed",
    released: "Released",
    reassigned: "Reassigned",
    dispo_changed: "Dispo changed",
    quoted_premium_changed: "Premium changed",
    agent_notes_edited: "Notes edited",
  };
  return map[action] ?? action;
}

function formatActivityDetails(
  action: string,
  d: Record<string, unknown>,
): string {
  const from = d.from as string | number | null | undefined;
  const to = d.to as string | number | null | undefined;
  if (action === "dispo_changed" || action === "quoted_premium_changed") {
    return `${from ?? "—"} → ${to ?? "—"}`;
  }
  if (action === "reassigned") return `${from ?? "—"} → ${to ?? "—"}`;
  return "";
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium break-words">{value}</div>
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${highlight ? "text-primary" : ""}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}