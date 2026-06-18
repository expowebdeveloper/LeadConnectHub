import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth, useHasRole } from "@/lib/auth";
import { getVendorLeadDetail, updateVendorLeadEmail } from "@/lib/vendor-lead-detail.functions";
import { DisputeDialog } from "@/components/DisputeDialog";
import { EmailLeadButton } from "@/components/EmailLeadButton";
import { TextLeadButton } from "@/components/TextLeadButton";
import { ArrowLeft, Lock, Pencil, Check, X } from "lucide-react";
import { PhoneLink } from "@/components/PhoneLink";
import { RecentCallsPanel } from "@/components/RecentCallsPanel";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EditLeadDialog as LeadWorkspaceDialog } from "@/routes/liveleads";
import { listSalesAgents, lookupVendorNames } from "@/lib/admin.functions";
import { canCloseLead } from "@/lib/closeGuard";

const searchSchema = z.object({
  source: z.enum(["live", "list"]).default("live"),
});

export const Route = createFileRoute("/leads/$leadId")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [{ title: "Lead details" }],
  }),
  component: LeadDetailPage,
});

function LeadDetailPage() {
  const isSales = useHasRole("sales", "admin");
  return isSales ? <SalesLeadWorkspace /> : <VendorLeadReadOnly />;
}

function SalesLeadWorkspace() {
  const { leadId } = Route.useParams();
  const { source } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchAgents = useServerFn(listSalesAgents);
  const lookupVendors = useServerFn(lookupVendorNames);
  const { user } = useAuth();
  const isAdmin = useHasRole("admin");

  const table = source === "list" ? "list_leads" : "leads";
  const otherTable = table === "leads" ? "list_leads" : "leads";

  const leadQ = useQuery({
    queryKey: ["lead-workspace", leadId, source],
    queryFn: async () => {
      // Try the requested source first.
      const primary = await (supabase.from(table) as any)
        .select("*")
        .eq("id", leadId)
        .maybeSingle();
      if (primary.error) throw new Error(primary.error.message);
      if (primary.data) {
        return { row: primary.data as Record<string, any>, resolved: table };
      }
      // Fall back to the other table; mirror the legacy resolvedSource behavior.
      const fallback = await (supabase.from(otherTable) as any)
        .select("*")
        .eq("id", leadId)
        .maybeSingle();
      if (fallback.error) throw new Error(fallback.error.message);
      if (fallback.data) {
        return { row: fallback.data as Record<string, any>, resolved: otherTable };
      }
      return { row: null, resolved: table };
    },
  });

  // Keep the URL's `source` in sync with whichever table actually had the row.
  useEffect(() => {
    if (!leadQ.data?.row) return;
    const resolvedParam = leadQ.data.resolved === "list_leads" ? "list" : "live";
    if (resolvedParam !== source) {
      navigate({
        to: "/leads/$leadId",
        params: { leadId },
        search: { source: resolvedParam },
        replace: true,
      });
    }
  }, [leadQ.data, source, leadId, navigate]);

  const row = leadQ.data?.row ?? null;
  const resolvedTable = (leadQ.data?.resolved ?? table) as "leads" | "list_leads";

  const agentsQ = useQuery({
    queryKey: ["sales-agents"],
    queryFn: () => fetchAgents({}),
    staleTime: 60_000,
  });

  const vendorId: string | null = row?.vendor_id ?? null;
  const vendorQ = useQuery({
    queryKey: ["vendor-lookup", vendorId],
    enabled: !!vendorId,
    queryFn: () => lookupVendors({ data: { vendor_ids: [vendorId!] } }),
    staleTime: 60_000,
  });

  const vendorProfile = (vendorQ.data ?? []).find((v: any) => v.id === vendorId) as
    | { company_name?: string | null; full_name?: string | null; email?: string | null; min_vehicles?: number | null; max_age?: number | null }
    | undefined;
  const vendorName = vendorProfile?.company_name || vendorProfile?.full_name || vendorProfile?.email || undefined;
  const vendorRules = vendorProfile
    ? { min_vehicles: vendorProfile.min_vehicles ?? null, max_age: vendorProfile.max_age ?? null }
    : null;

  const lead = row
    ? ({
        ...row,
        source: resolvedTable,
        vehicles: Array.isArray(row.vehicles) ? row.vehicles : [],
        num_vehicles: row.num_vehicles ?? 0,
      } as Record<string, any>)
    : null;

  const goBackRaw = () => {
    qc.invalidateQueries({ queryKey: ["lead-workspace", leadId] });
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      navigate({ to: "/liveleads" });
    }
  };
  const goBack = async () => {
    const ok = await canCloseLead(
      resolvedTable,
      leadId,
      user?.id ?? "",
      isAdmin,
    );
    if (ok) goBackRaw();
  };

  return (
    <AppShell>
      {leadQ.isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : !lead ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Lead not found.</div>
      ) : (
        <LeadWorkspaceDialog
          lead={lead as never}
          onClose={goBack}
          agents={agentsQ.data ?? []}
          vendorName={vendorName}
          vendorRules={vendorRules}
          source={resolvedTable}
          invalidateKeys={[["lead-workspace", leadId, source], ["leads"], ["list_leads"]]}
        />
      )}
    </AppShell>
  );
}

function Field({ label, value }: { label: string; value: unknown }) {
  const display =
    value === null || value === undefined || value === ""
      ? "—"
      : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{display}</div>
    </div>
  );
}

function PhoneField({
  value,
  dnc,
  leadId,
  leadTable,
  firstName,
  lastName,
}: {
  value: string | null | undefined;
  dnc?: boolean;
  leadId?: string;
  leadTable?: "leads" | "list_leads";
  firstName?: string | null;
  lastName?: string | null;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">Phone</div>
      <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <PhoneLink phone={value} stopPropagation={false} dnc={dnc} />
        {value && !dnc && (
          <TextLeadButton
            phone={value}
            leadId={leadId}
            leadTable={leadTable}
            firstName={firstName}
            lastName={lastName}
            className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted transition-colors"
          />
        )}
      </div>
    </div>
  );
}

function EmailField({
  leadId,
  source,
  value,
  queryKey,
  firstName,
  lastName,
}: {
  leadId: string;
  source: "live" | "list";
  value: string | null | undefined;
  queryKey: readonly unknown[];
  firstName?: string | null;
  lastName?: string | null;
}) {
  const qc = useQueryClient();
  const saveEmail = useServerFn(updateVendorLeadEmail);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  const start = () => {
    setDraft(value ?? "");
    setEditing(true);
  };

  const save = async () => {
    const trimmed = draft.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      toast.error("Enter a valid email address");
      return;
    }
    if (trimmed.length > 255) {
      toast.error("Email is too long");
      return;
    }
    setSaving(true);
    try {
      await saveEmail({ data: { leadId, source, email: trimmed } });
      toast.success(value ? "Email updated" : "Email added");
      await qc.invalidateQueries({ queryKey });
      setEditing(false);
    } catch (e) {
      toast.error((e as Error).message || "Failed to save email");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground">Email</div>
        <div className="flex items-center gap-2">
          <Input
            type="email"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={255}
            placeholder="name@example.com"
            autoFocus
            disabled={saving}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <Button size="icon" variant="default" onClick={save} disabled={saving} aria-label="Save email">
            <Check className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setEditing(false)} disabled={saving} aria-label="Cancel">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">Email</div>
      <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <span className="truncate">{value || "—"}</span>
        <div className="flex items-center gap-2 shrink-0">
          {value && (
            <EmailLeadButton
              email={value}
              leadId={leadId}
              leadTable={source === "live" ? "leads" : "list_leads"}
              firstName={firstName}
              lastName={lastName}
              className="px-2 py-1 text-[11px]"
            />
          )}
          <button
            type="button"
            onClick={start}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
            {value ? "Edit" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

function VendorLeadReadOnly() {
  const { leadId } = Route.useParams();
  const { source } = Route.useSearch();
  const { user } = useAuth();
  const isSales = useHasRole("sales", "admin");
  const navigate = useNavigate();
  const fetchDetail = useServerFn(getVendorLeadDetail);
  const asUserId = user?.id ?? null;

  const queryKey = ["vendor-lead-detail", leadId, source, asUserId] as const;
  const q = useQuery({
    queryKey,
    queryFn: () => fetchDetail({ data: { leadId, source, asUserId } }),
  });

  useEffect(() => {
    if (!q.data?.resolvedSource || q.data.resolvedSource === source) return;
    navigate({
      to: "/leads/$leadId",
      params: { leadId },
      search: { source: q.data.resolvedSource },
      replace: true,
    });
  }, [q.data?.resolvedSource, source, navigate, leadId]);

  const [disputeOpen, setDisputeOpen] = useState(false);

  const lead = (q.data?.lead ?? {}) as Record<string, any>;
  const dispute = q.data?.dispute;

  return (
    <AppShell>
      <PageHeader
        title="Lead details"
        description="Read-only view. Contact your admin to make changes after submission."
        action={
          <Button variant="outline" size="sm" onClick={() => navigate({ to: "/analytics" })}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
        }
      />

      {q.isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : q.data?.notFound ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Lead not found.</div>
      ) : q.isError ? (
        <div className="py-10 text-center text-sm text-destructive">
          {(q.error as Error)?.message || "Failed to load lead"}
        </div>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-muted-foreground" />
                {(lead.first_name ?? "") + " " + (lead.last_name ?? "")}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="capitalize">{source}</Badge>
                {dispute ? (
                  <Badge variant="secondary" className="capitalize">
                    Dispute: {dispute.status}
                  </Badge>
                ) : (
                  <button
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                    onClick={() => setDisputeOpen(true)}
                  >
                    Dispute
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <PhoneField
                value={lead.phone}
                dnc={lead.dispo === "dnc" || lead.home_dispo === "dnc"}
                leadId={leadId}
                leadTable={source === "live" ? "leads" : "list_leads"}
                firstName={lead.first_name}
                lastName={lead.last_name}
              />
              <EmailField leadId={leadId} source={source} value={lead.email} queryKey={queryKey} firstName={lead.first_name} lastName={lead.last_name} />
              <Field label="Date of birth" value={lead.date_of_birth} />
              <Field label="Street" value={lead.street} />
              <Field label="City" value={lead.city} />
              <Field label="State" value={lead.state} />
              <Field label="ZIP" value={lead.zip} />
              <Field label="County" value={lead.county} />
              <Field label="Current auto carrier" value={lead.current_carrier} />
              <Field label="Current home carrier" value={lead.current_home_carrier} />
              <Field label="# Vehicles" value={lead.num_vehicles} />
              <Field label="Housing status" value={lead.housing_status} />
              <Field label="Auto dispo" value={lead.dispo} />
              <Field label="Home dispo" value={lead.home_dispo} />
              <Field label="Quoted premium (auto)" value={lead.quoted_premium} />
              <Field label="Quoted premium (home)" value={lead.home_quoted_premium} />
              <Field label="Submitted" value={lead.created_at} />
            </CardContent>
          </Card>

          {isSales && lead.vendor_notes && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Your notes</CardTitle></CardHeader>
              <CardContent>
                <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
                  {String(lead.vendor_notes)}
                </div>
              </CardContent>
            </Card>
          )}

          <RecentCallsPanel
            scope="lead"
            leadId={leadId}
            leadTable={source === "live" ? "leads" : "list_leads"}
            title="Call history"
            emptyText="No calls logged for this lead yet."
          />

          {dispute && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Dispute</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">Reason:</span> {dispute.reason_category}</div>
                {dispute.reason_details && (
                  <div className="whitespace-pre-wrap">{dispute.reason_details}</div>
                )}
                <div><span className="text-muted-foreground">Status:</span>{" "}
                  <span className="capitalize font-medium">{dispute.status}</span>
                </div>
                {dispute.admin_notes && (
                  <div className="rounded border bg-muted/30 p-2">
                    <span className="text-muted-foreground">Admin notes:</span> {dispute.admin_notes}
                  </div>
                )}
                {dispute.evidence_paths?.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {dispute.evidence_paths.length} file(s) attached
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <DisputeDialog
        open={disputeOpen}
        onOpenChange={setDisputeOpen}
        leadId={leadId}
        source={source}
        reasons={[]}
      />

      <div className="mt-6 text-xs text-muted-foreground">
        <Link to="/analytics" className="underline">Return to performance</Link>
      </div>
    </AppShell>
  );
}