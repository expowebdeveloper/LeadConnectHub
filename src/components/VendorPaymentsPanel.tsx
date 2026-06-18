import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Info, DollarSign } from "lucide-react";
import { getVendorPayments } from "@/lib/vendor-payments.functions";
import { PhoneLink } from "@/components/PhoneLink";
import { useAuth } from "@/lib/auth";

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <Card className={accent ? "bg-primary text-primary-foreground" : ""}>
      <CardContent className="p-5">
        <div
          className={`flex items-center justify-between text-sm font-medium ${
            accent ? "opacity-80" : "text-muted-foreground"
          }`}
        >
          <span>{label}</span>
          {accent ? <DollarSign className="h-4 w-4" /> : null}
        </div>
        <div className="mt-2 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

export function VendorPaymentsPanel() {
  const { user } = useAuth();
  const asUserId = user?.id ?? null;
  const fetchPayments = useServerFn(getVendorPayments);
  const q = useQuery({
    queryKey: ["vendor-payments", asUserId],
    queryFn: () => fetchPayments({ data: { asUserId } }),
  });

  if (q.isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          Loading…
        </CardContent>
      </Card>
    );
  }
  if (q.error) {
    return (
      <Card>
        <CardContent className="p-6 text-destructive">
          {(q.error as Error).message}
        </CardContent>
      </Card>
    );
  }

  const data = q.data!;
  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Amount owed to you</AlertTitle>
        <AlertDescription>
          Based on the leads you've submitted. Your current default lead rate
          is {fmtMoney(data.rate)} per billable lead. Final payments are
          confirmed by the admin during billing.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Owed today" value={fmtMoney(data.totals.today)} />
        <Stat label="Owed this week" value={fmtMoney(data.totals.week)} />
        <Stat
          label="Owed this month"
          value={fmtMoney(data.totals.month)}
          accent
        />
        <Stat label="Last 90 days" value={fmtMoney(data.totals.total)} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-5 py-3 font-medium">
            Leads ({data.counts.billable} billable / {data.counts.total} total)
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.leads.map((l) => (
                <TableRow key={`${l.source}-${l.id}`}>
                  <TableCell>{l.created_at.slice(0, 10)}</TableCell>
                  <TableCell>
                    {[l.first_name, l.last_name].filter(Boolean).join(" ") ||
                      "—"}
                  </TableCell>
                  <TableCell><PhoneLink phone={l.phone} leadId={l.id} leadSource={l.source} /></TableCell>
                  <TableCell className="capitalize">{l.source}</TableCell>
                  <TableCell>
                    {l.not_billable ? (
                      <span title={l.not_billable_reasons.join(" ")}>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Not billable</Badge>
                      </span>
                    ) : l.cost > 0 ? (
                      <Badge>Owed</Badge>
                    ) : (
                      <Badge variant="outline">No rate</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {fmtMoney(l.cost)}
                  </TableCell>
                </TableRow>
              ))}
              {data.leads.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-muted-foreground"
                  >
                    No leads submitted in the last 90 days.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}