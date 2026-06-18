import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth, useHasRole } from "@/lib/auth";
import {
  getPerformanceInsights,
  getVendorQuality,
  getPipelineForecast,
} from "@/lib/insights.functions";
import {
  PhoneCall,
  Clock,
  TrendingUp,
  AlertTriangle,
  Gauge,
  Timer,
  DollarSign,
  Hourglass,
} from "lucide-react";

export const Route = createFileRoute("/insights")({
  head: () => ({
    meta: [
      { title: "Insights — LeadVault" },
      {
        name: "description",
        content:
          "Telephony, lead lifecycle, vendor quality, and pipeline forecasting metrics.",
      },
    ],
  }),
  component: InsightsPage,
});

type Period = "day" | "week" | "month";

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function money(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function InsightsPage() {
  const { user, loading } = useAuth();
  const isAdmin = useHasRole("admin");
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>("week");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  const fetchPerf = useServerFn(getPerformanceInsights);
  const fetchVendor = useServerFn(getVendorQuality);
  const fetchForecast = useServerFn(getPipelineForecast);

  const perfQ = useQuery({
    queryKey: ["insights-perf", period, user?.id],
    queryFn: () => fetchPerf({ data: { period } }),
    enabled: !!user,
  });

  const vendorQ = useQuery({
    queryKey: ["insights-vendor"],
    queryFn: () => fetchVendor(),
    enabled: !!user && isAdmin,
  });

  const forecastQ = useQuery({
    queryKey: ["insights-forecast", user?.id],
    queryFn: () => fetchForecast(),
    enabled: !!user,
  });

  if (loading || !user) return null;

  const p = perfQ.data;

  return (
    <AppShell>
      <PageHeader
        title="Performance Insights"
        description="Metrics already in your data, finally surfaced — calls, lifecycle timing, vendor quality, and pipeline forecast."
        action={
          <div className="inline-flex rounded-lg border bg-muted p-1">
            {(["day", "week", "month"] as Period[]).map((x) => (
              <button
                key={x}
                onClick={() => setPeriod(x)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                  period === x
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {x === "day" ? "Today" : `This ${x}`}
              </button>
            ))}
          </div>
        }
      />

      {/* Call Performance */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Call Performance
        </h2>
        <div className="grid gap-3 md:grid-cols-5">
          <Stat
            icon={<PhoneCall className="h-4 w-4" />}
            label="Total calls"
            value={p?.telephony.totalCalls ?? 0}
          />
          <Stat
            icon={<TrendingUp className="h-4 w-4" />}
            label="Contact rate"
            value={`${p?.telephony.contactRate ?? 0}%`}
            sub={`${p?.telephony.connected ?? 0} connected`}
          />
          <Stat
            icon={<Timer className="h-4 w-4" />}
            label="Talk time"
            value={formatDuration(p?.telephony.talkSeconds ?? 0)}
          />
          <Stat
            icon={<Gauge className="h-4 w-4" />}
            label="Avg handle time"
            value={formatDuration(p?.telephony.ahtSeconds ?? 0)}
            sub="per connected call"
          />
          <Stat
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Abandon rate"
            value={`${p?.telephony.abandonRate ?? 0}%`}
            sub={`${p?.telephony.abandoned ?? 0} dropped`}
          />
        </div>

        {isAdmin && (p?.perAgent.length ?? 0) > 0 && (
          <Card className="mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">By agent</CardTitle>
              <CardDescription>Activity in the selected period.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Agent</th>
                      <th className="px-4 py-2 text-right">Calls</th>
                      <th className="px-4 py-2 text-right">Connected</th>
                      <th className="px-4 py-2 text-right">Contact %</th>
                      <th className="px-4 py-2 text-right">Talk time</th>
                      <th className="px-4 py-2 text-right">AHT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p!.perAgent.map((a) => (
                      <tr key={a.id} className="border-b last:border-0">
                        <td className="px-4 py-2 font-medium">{a.name}</td>
                        <td className="px-4 py-2 text-right">{a.calls}</td>
                        <td className="px-4 py-2 text-right">{a.connected}</td>
                        <td className="px-4 py-2 text-right">{a.contactRate}%</td>
                        <td className="px-4 py-2 text-right">
                          {formatDuration(a.talkSeconds)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {formatDuration(a.aht)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Lifecycle */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Lead Lifecycle
        </h2>
        <div className="grid gap-3 md:grid-cols-4">
          <Stat
            icon={<Clock className="h-4 w-4" />}
            label="Avg speed-to-touch"
            value={formatDuration(p?.lifecycle.avgSpeedToTouchSec ?? 0)}
            sub={`p50 ${formatDuration(p?.lifecycle.p50SpeedToTouchSec ?? 0)} · p90 ${formatDuration(p?.lifecycle.p90SpeedToTouchSec ?? 0)}`}
          />
          <Stat
            icon={<Gauge className="h-4 w-4" />}
            label="Follow-up SLA"
            value={`${p?.lifecycle.slaHitRate ?? 0}%`}
            sub={`${p?.lifecycle.slaHit ?? 0}/${p?.lifecycle.slaTotal ?? 0} on time`}
          />
          <Stat
            icon={<Hourglass className="h-4 w-4" />}
            label="Aging 7–14 days"
            value={p?.lifecycle.aging.gt7 ?? 0}
            sub={`>3d: ${p?.lifecycle.aging.gt3 ?? 0}`}
          />
          <Stat
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Stale >14 days"
            value={p?.lifecycle.aging.gt14 ?? 0}
            sub="open quoted / follow-up / x-date"
          />
        </div>
      </section>

      {/* Pipeline Forecast */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Pipeline Forecast
        </h2>
        <div className="grid gap-3 md:grid-cols-4">
          <Stat
            icon={<DollarSign className="h-4 w-4" />}
            label="Weighted pipeline"
            value={money(forecastQ.data?.totals.weighted ?? 0)}
            sub={`Gross open ${money(forecastQ.data?.totals.gross ?? 0)}`}
          />
          <Stat
            icon={<TrendingUp className="h-4 w-4" />}
            label="Forecast (30d)"
            value={money(forecastQ.data?.totals.next30 ?? 0)}
          />
          <Stat
            icon={<TrendingUp className="h-4 w-4" />}
            label="Forecast (60d)"
            value={money(forecastQ.data?.totals.next60 ?? 0)}
          />
          <Stat
            icon={<TrendingUp className="h-4 w-4" />}
            label="Forecast (90d)"
            value={money(forecastQ.data?.totals.next90 ?? 0)}
          />
        </div>
        {forecastQ.data && (
          <Card className="mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Breakdown by stage</CardTitle>
              <CardDescription>
                Weighted = open premium × historical close probability.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Stage</th>
                    <th className="px-4 py-2 text-right">Count</th>
                    <th className="px-4 py-2 text-right">Probability</th>
                    <th className="px-4 py-2 text-right">Gross</th>
                    <th className="px-4 py-2 text-right">Weighted</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(forecastQ.data.byDispo).map(([stage, v]) => (
                    <tr key={stage} className="border-b last:border-0">
                      <td className="px-4 py-2 font-medium capitalize">
                        {stage.replace("_", " ")}
                      </td>
                      <td className="px-4 py-2 text-right">{v.count}</td>
                      <td className="px-4 py-2 text-right">
                        {Math.round(v.probability * 100)}%
                      </td>
                      <td className="px-4 py-2 text-right">{money(v.gross)}</td>
                      <td className="px-4 py-2 text-right font-semibold">
                        {money(v.weighted)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Vendor Quality */}
      {isAdmin && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Vendor Quality (last 90 days)
          </h2>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Vendor</th>
                      <th className="px-4 py-2 text-right">Leads</th>
                      <th className="px-4 py-2 text-right">Sold</th>
                      <th className="px-4 py-2 text-right">Sell-through</th>
                      <th className="px-4 py-2 text-right">Spend</th>
                      <th className="px-4 py-2 text-right">Cost / sale</th>
                      <th className="px-4 py-2 text-right">Rejects</th>
                      <th className="px-4 py-2 text-right">Disputes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(vendorQ.data ?? []).map((v) => (
                      <tr key={v.vendor_id} className="border-b last:border-0">
                        <td className="px-4 py-2 font-medium">{v.name}</td>
                        <td className="px-4 py-2 text-right">{v.leads}</td>
                        <td className="px-4 py-2 text-right">{v.sold}</td>
                        <td className="px-4 py-2 text-right">{v.sellThrough}%</td>
                        <td className="px-4 py-2 text-right">{money(v.spend)}</td>
                        <td className="px-4 py-2 text-right">
                          {v.costPerSale > 0 ? money(v.costPerSale) : "—"}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {v.rejections} ({v.rejectRate}%)
                        </td>
                        <td className="px-4 py-2 text-right">
                          {v.disputes}
                          {v.disputes > 0 ? ` (${v.disputeApprovalRate}% approved)` : ""}
                        </td>
                      </tr>
                    ))}
                    {(vendorQ.data ?? []).length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                          No vendor activity in the last 90 days.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      )}
    </AppShell>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
          {icon}
        </div>
        <div className="mt-1.5 text-2xl font-semibold">{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}