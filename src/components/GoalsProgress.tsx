import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getGoalProgress, type GoalMetric, type GoalPeriod } from "@/lib/goals.functions";
import { ShieldCheck, Banknote, Boxes, Target } from "lucide-react";
import { EmptyCTA } from "@/components/EmptyCTA";

const PERIOD_LABEL: Record<GoalPeriod, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

const METRIC_LABEL: Record<GoalMetric, string> = {
  policies: "Policies",
  items: "Items",
  premium: "Premium",
};

const METRIC_ICON: Record<GoalMetric, React.ElementType> = {
  policies: ShieldCheck,
  items: Boxes,
  premium: Banknote,
};

const THEME: Record<GoalMetric, {
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  iconBg: string;
  iconBorder: string;
  iconText: string;
  barFrom: string;
  barVia: string;
  barTo: string;
  barShadowColor: string;
  textAccent: string;
  accentBg: string;
}> = {
  policies: {
    badgeBg: "bg-sky-500/10",
    badgeText: "text-sky-600 dark:text-sky-300",
    badgeBorder: "border-sky-500/20",
    iconBg: "bg-sky-500/10",
    iconBorder: "border-sky-500/20",
    iconText: "text-sky-600 dark:text-sky-300",
    barFrom: "from-sky-500",
    barVia: "via-sky-400",
    barTo: "to-blue-500",
    barShadowColor: "rgba(14,165,233,0.35)",
    textAccent: "text-sky-600 dark:text-sky-300",
    accentBg: "bg-sky-500/5",
  },
  premium: {
    badgeBg: "bg-violet-500/10",
    badgeText: "text-violet-600 dark:text-violet-300",
    badgeBorder: "border-violet-500/20",
    iconBg: "bg-violet-500/10",
    iconBorder: "border-violet-500/20",
    iconText: "text-violet-600 dark:text-violet-300",
    barFrom: "from-violet-500",
    barVia: "via-purple-500",
    barTo: "to-indigo-500",
    barShadowColor: "rgba(139,92,246,0.35)",
    textAccent: "text-violet-600 dark:text-violet-300",
    accentBg: "bg-violet-500/5",
  },
  items: {
    badgeBg: "bg-emerald-500/10",
    badgeText: "text-emerald-600 dark:text-emerald-300",
    badgeBorder: "border-emerald-500/20",
    iconBg: "bg-emerald-500/10",
    iconBorder: "border-emerald-500/20",
    iconText: "text-emerald-600 dark:text-emerald-300",
    barFrom: "from-emerald-500",
    barVia: "via-green-400",
    barTo: "to-teal-500",
    barShadowColor: "rgba(16,185,129,0.35)",
    textAccent: "text-emerald-600 dark:text-emerald-300",
    accentBg: "bg-emerald-500/5",
  },
};

function formatValue(metric: GoalMetric, n: number) {
  if (metric === "premium") {
    return n.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }
  return Math.round(n).toLocaleString();
}

export function GoalsProgress({
  scope,
  agentId,
  title,
  description,
  compact,
  period,
}: {
  scope: "agency" | "agent";
  agentId?: string | null;
  title?: string;
  description?: string;
  compact?: boolean;
  period?: GoalPeriod;
}) {
  const fetchProgress = useServerFn(getGoalProgress);
  const { data, isLoading } = useQuery({
    queryKey: ["goal-progress", scope, agentId ?? null],
    queryFn: () =>
      fetchProgress({ data: { scope, agentId: agentId ?? null } }),
    retry: false,
  });

  const allRows = data?.progress ?? [];
  const rows = period ? allRows.filter((g) => g.period === period) : allRows;

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {(title || description) && (
        <div className="flex items-center gap-2">
          {title && (
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              {title}
            </h3>
          )}
        </div>
      )}
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyCTA
          icon={Target}
          title={scope === "agency" ? "No agency goals set yet" : "No goals for this view"}
          description={
            scope === "agency"
              ? "Ask an admin to set agency targets so you can track team-wide progress."
              : "Start closing — every sale moves the needle on your weekly, monthly, quarterly, and yearly goals."
          }
          actions={
            scope === "agency"
              ? [{ label: "Open My Board", to: "/my-leads" }]
              : [
                  { label: "Browse Live Leads", to: "/call-queue" },
                  { label: "Open My Board", to: "/my-leads", variant: "outline" },
                ]
          }
          size="sm"
        />
      ) : (
        <div className={`grid gap-4 ${compact ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"}`}>
          {rows.map((g) => {
            const pct = g.target > 0 ? Math.min(100, (g.actual / g.target) * 100) : 0;
            const reached = g.actual >= g.target && g.target > 0;
            const theme = THEME[g.metric];
            const Icon = METRIC_ICON[g.metric];
            const barWidth = `${pct.toFixed(1)}%`;

            return (
              <div
                key={`${g.period}-${g.metric}`}
                className="group relative rounded-xl border border-border bg-card p-4 flex flex-col gap-3 overflow-hidden transition-shadow hover:shadow-md"
              >
                {/* Subtle accent wash */}
                <div className={`pointer-events-none absolute inset-0 ${theme.accentBg}`} />

                {/* Header */}
                <div className="relative flex justify-between items-start gap-3">
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wider ${theme.badgeText} ${theme.badgeBg} ${theme.badgeBorder} border rounded-full px-2 py-0.5 w-fit`}
                    >
                      {PERIOD_LABEL[g.period]}
                    </span>
                    <h4 className="text-sm font-semibold text-foreground tracking-tight">
                      {METRIC_LABEL[g.metric]}
                    </h4>
                  </div>
                  <div
                    className={`shrink-0 h-9 w-9 rounded-lg ${theme.iconBg} flex items-center justify-center border ${theme.iconBorder}`}
                  >
                    <Icon className={`h-4 w-4 ${theme.iconText}`} />
                  </div>
                </div>

                {/* Value */}
                <div className="relative space-y-2 min-w-0">
                  <div className="flex justify-between items-end gap-2 min-w-0">
                    <div className="flex items-baseline gap-1.5 min-w-0 flex-1">
                      <span className="text-2xl font-bold tabular-nums tracking-tight text-foreground truncate">
                        {formatValue(g.metric, g.actual)}
                      </span>
                      <span className="text-xs text-muted-foreground font-medium truncate">
                        / {formatValue(g.metric, g.target)}
                      </span>
                    </div>
                    <div className={`shrink-0 text-sm font-semibold tabular-nums ${theme.textAccent}`}>
                      {pct.toFixed(0)}%
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="relative h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className={`relative h-full rounded-full bg-gradient-to-r ${theme.barFrom} ${theme.barVia} ${theme.barTo} transition-all duration-700 ease-out`}
                      style={{
                        width: barWidth,
                        boxShadow: `0 0 8px ${theme.barShadowColor}`,
                      }}
                    />
                  </div>
                </div>

                {/* Footer status */}
                <div className="relative flex justify-between items-center text-xs gap-2">
                  <span className="text-muted-foreground truncate">
                    {reached
                      ? "🎉 Goal reached!"
                      : `${formatValue(g.metric, g.target - g.actual)} remaining`}
                  </span>
                  {reached && (
                    <span className="shrink-0 text-emerald-600 dark:text-emerald-300 font-semibold uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                      Done
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
