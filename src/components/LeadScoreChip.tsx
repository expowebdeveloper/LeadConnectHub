import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tier = "S" | "A" | "B" | "C" | null | undefined;

export function tierLabel(tier: Tier): string | null {
  switch (tier) {
    case "S": return "iVantage";
    case "A": return "Win-back";
    case "B": return "Requote";
    case "C": return "Aged";
    default:  return null;
  }
}

export function scoreBandClass(score: number | null | undefined): string {
  const s = Number(score ?? 0);
  if (s >= 80) return "bg-emerald-100 text-emerald-900 border-emerald-300";
  if (s >= 60) return "bg-amber-100 text-amber-900 border-amber-300";
  if (s >= 40) return "bg-slate-100 text-slate-900 border-slate-300";
  return "bg-muted text-muted-foreground border-border";
}

function tierClass(tier: Tier): string {
  switch (tier) {
    case "S": return "bg-fuchsia-100 text-fuchsia-900 border-fuchsia-300";
    case "A": return "bg-emerald-100 text-emerald-900 border-emerald-300";
    case "B": return "bg-sky-100 text-sky-900 border-sky-300";
    case "C": return "bg-rose-100 text-rose-900 border-rose-300";
    default:  return "";
  }
}

export function LeadScoreChip({
  score,
  tier,
  size = "sm",
  showTier = true,
}: {
  score: number | null | undefined;
  tier?: Tier;
  size?: "sm" | "xs";
  showTier?: boolean;
}) {
  if (score == null) return null;
  const tl = tierLabel(tier);
  const pad = size === "xs" ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]";
  return (
    <span className="inline-flex items-center gap-1">
      <Badge
        variant="outline"
        title={`Lead score ${score}${tl ? ` · ${tl}` : ""}`}
        className={cn("font-semibold tabular-nums", pad, scoreBandClass(score))}
      >
        {score}
      </Badge>
      {showTier && tl && (
        <Badge variant="outline" className={cn(pad, tierClass(tier))}>
          {tier}·{tl}
        </Badge>
      )}
    </span>
  );
}