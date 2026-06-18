import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { PhoneLink } from "@/components/PhoneLink";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getVendorPayments } from "@/lib/vendor-payments.functions";
import { listMyDisputes, type LeadDispute } from "@/lib/disputes.functions";
import { listMyPostRejections } from "@/lib/vendor-post-rejections.functions";
import { DisputeDialog } from "@/components/DisputeDialog";
import { useAuth } from "@/lib/auth";
import { AlertCircle } from "lucide-react";

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

type RangeKey = "day" | "week" | "lastWeek" | "month" | "custom";

function startOf(kind: "day" | "week" | "lastWeek" | "month"): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (kind === "week") d.setDate(d.getDate() - d.getDay());
  if (kind === "lastWeek") {
    const daysSinceSunday = d.getDay();
    d.setDate(d.getDate() - daysSinceSunday - 7);
  }
  if (kind === "month") d.setDate(1);
  return d;
}

function toDateInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function VendorLeadsBreakdown() {
  const { user } = useAuth();
  const asUserId = user?.id ?? null;
  const fetchPayments = useServerFn(getVendorPayments);
  const fetchDisputes = useServerFn(listMyDisputes);
  const fetchRejections = useServerFn(listMyPostRejections);
  const q = useQuery({
    queryKey: ["vendor-payments", asUserId],
    queryFn: () => fetchPayments({ data: { asUserId } }),
  });
  const disputesQ = useQuery({
    queryKey: ["my-disputes", asUserId],
    queryFn: () => fetchDisputes({ data: { asUserId } }),
  });
  const rejectionsQ = useQuery({
    queryKey: ["my-post-rejections", asUserId],
    queryFn: () => fetchRejections({ data: { asUserId } }),
    refetchInterval: 60_000,
  });
  const disputeByKey = useMemo(() => {
    const m = new Map<string, LeadDispute>();
    for (const d of disputesQ.data ?? []) {
      const key = `${d.lead_source}-${d.lead_id}`;
      const cur = m.get(key);
      if (!cur || new Date(d.created_at) > new Date(cur.created_at)) m.set(key, d);
    }
    return m;
  }, [disputesQ.data]);

  const [disputeFor, setDisputeFor] = useState<{
    leadId: string;
    source: "live" | "list";
    reasons: string[];
  } | null>(null);

  const [range, setRange] = useState<RangeKey>("week");
  const [customStart, setCustomStart] = useState<string>(toDateInput(startOf("month")));
  const [customEnd, setCustomEnd] = useState<string>(toDateInput(new Date()));

  const { start, end } = useMemo(() => {
    if (range === "custom") {
      const s = new Date(customStart);
      s.setHours(0, 0, 0, 0);
      const e = new Date(customEnd);
      e.setHours(23, 59, 59, 999);
      return { start: s, end: e };
    }
    const e = new Date();
    if (range === "lastWeek") {
      const daysSinceSunday = e.getDay();
      e.setDate(e.getDate() - daysSinceSunday - 1);
      e.setHours(23, 59, 59, 999);
    }
    return { start: startOf(range), end: e };
  }, [range, customStart, customEnd]);

  const leads = q.data?.leads ?? [];
  const filtered = useMemo(
    () =>
      leads.filter((l) => {
        const t = new Date(l.created_at).getTime();
        return t >= start.getTime() && t <= end.getTime();
      }),
    [leads, start, end],
  );

  const totalOwed = filtered.reduce((s, l) => s + l.cost, 0);
  const billableCount = filtered.filter((l) => l.cost > 0).length;
  const showSubmittedBy = filtered.some((l) => !!l.submitted_by_name);

  return (
    <Card>
      <CardHeader>
        <CardTitle>My Leads</CardTitle>
        <CardDescription>
          Detailed breakdown of leads you submitted, billable status, and amount earned.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PostRejectionsAlert rejections={rejectionsQ.data ?? []} />
        <div className="flex flex-wrap items-end gap-3">
          <Tabs value={range} onValueChange={(v) => setRange(v as RangeKey)}>
            <TabsList>
              <TabsTrigger value="day">Today</TabsTrigger>
              <TabsTrigger value="week">This Week</TabsTrigger>
              <TabsTrigger value="lastWeek">Last Week</TabsTrigger>
              <TabsTrigger value="month">This Month</TabsTrigger>
              <TabsTrigger value="custom">Custom</TabsTrigger>
            </TabsList>
          </Tabs>
          {range === "custom" && (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="vlb-start" className="text-xs">From</Label>
                <Input
                  id="vlb-start"
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="h-9"
                />
              </div>
              <div>
                <Label htmlFor="vlb-end" className="text-xs">To</Label>
                <Input
                  id="vlb-end"
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
          )}
        </div>

        {q.isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="rounded-md border">
            <div className="flex items-center justify-between border-b px-4 py-2 text-sm text-muted-foreground">
              <span>
                {filtered.length} leads ({billableCount} billable)
              </span>
              <span>
                Total earned:{" "}
                <span className="font-semibold text-foreground">{fmtMoney(totalOwed)}</span>
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  {showSubmittedBy && <TableHead>Submitted by</TableHead>}
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((l) => (
                  <TableRow key={`${l.source}-${l.id}`}>
                    <TableCell>{l.created_at.slice(0, 10)}</TableCell>
                    <TableCell>
                      <Link
                        to="/leads/$leadId"
                        params={{ leadId: l.id }}
                        search={{ source: l.source }}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {[l.first_name, l.last_name].filter(Boolean).join(" ") || "—"}
                      </Link>
                    </TableCell>
                    <TableCell><PhoneLink phone={l.phone} leadId={l.id} leadSource={l.source} /></TableCell>
                    {showSubmittedBy && (
                      <TableCell className="text-sm text-muted-foreground">
                        {l.submitted_by_name ?? "—"}
                      </TableCell>
                    )}
                    <TableCell className="capitalize">{l.source}</TableCell>
                    <TableCell>
                      {l.not_billable ? (() => {
                        const key = `${l.source}-${l.id}`;
                        const existing = disputeByKey.get(key);
                        const reasons = l.not_billable_reasons ?? [];
                        return (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="inline-flex items-center gap-1">
                                <Badge variant="secondary" className="cursor-pointer text-[10px] px-1.5 py-0">
                                  <AlertCircle className="mr-1 h-2.5 w-2.5" />
                                  Not billable
                                </Badge>
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80 space-y-3 text-sm">
                              <div>
                                <div className="mb-1 font-medium">Why this lead isn't billable</div>
                                {reasons.length === 0 ? (
                                  <p className="text-muted-foreground">No specific reason recorded.</p>
                                ) : (
                                  <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                                    {reasons.map((r) => <li key={r}>{r}</li>)}
                                  </ul>
                                )}
                              </div>
                              {existing ? (
                                <div className="rounded border bg-muted/30 p-2 text-xs">
                                  Dispute status:{" "}
                                  <span className="font-medium capitalize">{existing.status}</span>
                                  {existing.admin_notes && (
                                    <div className="mt-1 text-muted-foreground">
                                      Admin: {existing.admin_notes}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <button
                                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                                  onClick={() =>
                                    setDisputeFor({ leadId: l.id, source: l.source, reasons })
                                  }
                                >
                                  Raise dispute
                                </button>
                              )}
                            </PopoverContent>
                          </Popover>
                        );
                      })() : l.cost > 0 ? (
                        <Badge>Billable</Badge>
                      ) : (
                        <Badge variant="outline">No rate</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{fmtMoney(l.cost)}</TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={showSubmittedBy ? 7 : 6} className="py-10 text-center text-muted-foreground">
                      No leads in this period.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              {filtered.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={showSubmittedBy ? 6 : 5} className="text-right font-medium">
                      Total
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {fmtMoney(totalOwed)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        )}
        {disputeFor && (
          <DisputeDialog
            open={!!disputeFor}
            onOpenChange={(v) => { if (!v) setDisputeFor(null); }}
            leadId={disputeFor.leadId}
            source={disputeFor.source}
            reasons={disputeFor.reasons}
          />
        )}
      </CardContent>
    </Card>
  );
}

function PostRejectionsAlert({
  rejections,
}: {
  rejections: Array<{
    id: string;
    endpoint: string;
    reason: string;
    phone: string | null;
    first_name: string | null;
    last_name: string | null;
    created_at: string;
  }>;
}) {
  const [expanded, setExpanded] = useState(false);
  if (rejections.length === 0) return null;
  const litigatorCount = rejections.filter((r) => r.reason === "TCPA litigator").length;
  const otherCount = rejections.length - litigatorCount;
  const shown = expanded ? rejections : rejections.slice(0, 5);
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
        <div className="flex-1 space-y-2">
          <div className="text-sm font-medium text-destructive">
            {rejections.length} lead{rejections.length === 1 ? "" : "s"} you posted in
            the last 30 days {rejections.length === 1 ? "was" : "were"} rejected
            {litigatorCount > 0 && ` (${litigatorCount} TCPA litigator)`}
            {otherCount > 0 && ` (${otherCount} other)`}
          </div>
          <div className="overflow-hidden rounded border border-destructive/20 bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 text-xs">When</TableHead>
                  <TableHead className="h-8 text-xs">Name</TableHead>
                  <TableHead className="h-8 text-xs">Phone</TableHead>
                  <TableHead className="h-8 text-xs">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="py-1.5 text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs">
                      {[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs font-mono">
                      {r.phone ?? "—"}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs">
                      {r.reason === "TCPA litigator" ? (
                        <Badge variant="destructive" className="text-[10px]">
                          TCPA litigator
                        </Badge>
                      ) : (
                        <span>{r.reason}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {rejections.length > 5 && (
            <button
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Show fewer" : `Show all ${rejections.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}