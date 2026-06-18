import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth, useHasRole } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { getTelemarketerStats } from "@/lib/telemarketer.functions";
import { RecentCallsPanel } from "@/components/RecentCallsPanel";
import { Shield, PhoneCall, ArrowRightCircle, DollarSign, Target } from "lucide-react";

export const Route = createFileRoute("/telemarketer")({
  head: () => ({
    meta: [
      { title: "My Performance — LeadVault" },
      { name: "description", content: "Telemarketer activity, transfers, and goal progress." },
    ],
  }),
  component: TelemarketerPage,
});

type Period = "day" | "week" | "month";

function TelemarketerPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const isTelemarketer = useHasRole("telemarketer");
  const isAdmin = useHasRole("admin");
  const [period, setPeriod] = useState<Period>("day");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  const fetchStats = useServerFn(getTelemarketerStats);
  const statsQ = useQuery({
    queryKey: ["tm-stats", period, user?.id],
    queryFn: () => fetchStats({ data: { period } }),
    enabled: !!user,
  });

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Shield className="h-8 w-8 animate-pulse text-primary" />
      </div>
    );
  }

  if (!(isTelemarketer || isAdmin)) {
    return (
      <AppShell>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Telemarketer access required.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const s = statsQ.data;
  const goalApplies = !!s?.goal_period && s.goal_period === period;
  const conversion =
    s && s.transfers > 0 ? Math.round((s.sold / s.transfers) * 100) : 0;

  return (
    <AppShell>
      <PageHeader
        title="My Performance"
        description="Your activity and progress toward goals."
        action={
          <div className="inline-flex rounded-lg border bg-muted p-1">
            {(["day", "week", "month"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                  period === p
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p === "day" ? "Today" : `This ${p}`}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Stat
          icon={<PhoneCall className="h-5 w-5" />}
          label="Calls logged"
          value={s?.calls ?? 0}
          goal={goalApplies ? s?.goal_calls ?? null : null}
        />
        <Stat
          icon={<ArrowRightCircle className="h-5 w-5" />}
          label="Transfers"
          value={s?.transfers ?? 0}
          goal={goalApplies ? s?.goal_transfers ?? null : null}
        />
        <Stat
          icon={<Target className="h-5 w-5" />}
          label="Sold"
          value={s?.sold ?? 0}
          sub={`${conversion}% conversion`}
        />
        <Stat
          icon={<DollarSign className="h-5 w-5" />}
          label="Premium sold"
          value={`$${Math.round(s?.sold_premium ?? 0).toLocaleString()}`}
        />
      </div>

      {s?.goal_period && s.goal_period !== period && (
        <Card className="mt-4">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Your goal is set for the <span className="font-medium capitalize">{s.goal_period}</span>.
            Switch the period above to see progress against it.
          </CardContent>
        </Card>
      )}

      {!s?.goal_period && (
        <Card className="mt-4">
          <CardContent className="p-4 text-sm text-muted-foreground">
            No goals set yet. Your admin can configure them from the Users page.
          </CardContent>
        </Card>
      )}

      <div className="mt-6">
        <RecentCallsPanel scope="me" limit={25} title="Recent calls" />
      </div>
    </AppShell>
  );
}

function Stat({
  icon,
  label,
  value,
  goal,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  goal?: number | null;
  sub?: string;
}) {
  const numeric = typeof value === "number" ? value : 0;
  const pct = goal && goal > 0 ? Math.min(100, Math.round((numeric / goal) * 100)) : null;
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-sm font-medium">{label}</span>
          {icon}
        </div>
        <div className="mt-2 text-2xl font-semibold">{value}</div>
        {goal != null && (
          <>
            <div className="mt-2 h-2 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary"
                style={{ width: `${pct ?? 0}%` }}
              />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Goal: {goal} · {pct ?? 0}%
            </div>
          </>
        )}
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}