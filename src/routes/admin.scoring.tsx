import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth, useHasRole } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { getScoringWeights, updateScoringWeights, getScoreDistribution } from "@/lib/scoring.functions";
import { LeadScoreChip, scoreBandClass, tierLabel } from "@/components/LeadScoreChip";
import { toast } from "sonner";
import { Shield } from "lucide-react";

export const Route = createFileRoute("/admin/scoring")({
  head: () => ({
    meta: [
      { title: "Lead Scoring — LeadVault" },
      { name: "description", content: "Tune the lead scoring model and view distribution." },
    ],
  }),
  component: AdminScoringPage,
});

const WEIGHT_GROUPS: { title: string; keys: { k: string; label: string; help?: string }[] }[] = [
  {
    title: "Per-side components (auto + home)",
    keys: [
      { k: "vehicle_per_unit", label: "Points per vehicle", help: "5 = each vehicle adds 5 pts" },
      { k: "vehicle_cap", label: "Vehicle cap", help: "Max vehicle points" },
      { k: "age_max", label: "Age band (max)" },
      { k: "recency_max", label: "Recency (max)" },
      { k: "contact_max", label: "Contactability (max)" },
      { k: "source_max", label: "Source quality (max)" },
      { k: "engagement_max", label: "Engagement history (max)" },
    ],
  },
  {
    title: "Home-only signals",
    keys: [
      { k: "bundling_max", label: "Auto+Home bundling (max)" },
      { k: "property_max", label: "Property completeness (max)" },
    ],
  },
  {
    title: "Priority tier modifiers",
    keys: [
      { k: "tier_ivantage_bonus", label: "S · iVantage non-Allstate bonus" },
      { k: "tier_winback_bonus", label: "A · Win-back bonus" },
      { k: "tier_requote_bonus", label: "B · Requote bonus" },
      { k: "tier_aged_penalty", label: "C · Aged penalty (negative)" },
      { k: "aged_days", label: "Aged threshold (days)" },
    ],
  },
  {
    title: "Recent contact boost",
    keys: [
      { k: "recent_contact_bonus", label: "Recent contact bonus", help: "Extra points added to a lead that was dialed in the last N days. Keeps actively-worked leads at the top regardless of car count." },
      { k: "recent_contact_days", label: "Recent contact window (days)", help: "Window in days. The bonus decays linearly to 0 at the edge of this window." },
      { k: "fresh_upload_bonus", label: "Fresh upload bonus", help: "Extra points added to leads created in the last N days. Ensures freshly uploaded inventory gets worked first." },
      { k: "fresh_upload_days", label: "Fresh upload window (days)", help: "Window in days. The bonus decays linearly to 0 at the edge of this window." },
    ],
  },
  {
    title: "Shark-tank release penalty",
    keys: [
      { k: "release_penalty_per", label: "Penalty per release", help: "Points subtracted for each time a lead is unclaimed back to shark tank" },
      { k: "release_penalty_cap", label: "Max penalty", help: "Hard cap regardless of release count" },
      { k: "release_penalty_decay_days", label: "Decay window (days)", help: "Penalty fades linearly to 0 over this many days since last release. Default 180 (~6 months)." },
    ],
  },
];

const CARRIER_PTS: { k: string; label: string; help: string }[] = [
  { k: "carrier_pts_premium",  label: "Premium carrier pts", help: "Expensive carriers — easiest to switch (Farmers, AAA…)" },
  { k: "carrier_pts_standard", label: "Standard carrier pts", help: "Mid-tier (State Farm, Allstate, USAA…)" },
  { k: "carrier_pts_cheap",    label: "Cheap carrier pts",   help: "Low-cost carriers — hardest to beat (Geico, Progressive…)" },
  { k: "carrier_pts_nonstandard", label: "Non-standard carrier pts", help: "High-risk / non-standard markets — prospect may not even qualify (The General, Dairyland…)" },
  { k: "carrier_pts_none",     label: "No current insurance pts", help: "Uninsured / no carrier on file" },
  { k: "carrier_pts_unknown",  label: "Unknown carrier pts", help: "Carrier present but not in any list above" },
];
const CARRIER_LISTS: { k: "carriers_premium" | "carriers_standard" | "carriers_cheap" | "carriers_nonstandard"; label: string }[] = [
  { k: "carriers_premium",  label: "Premium carriers" },
  { k: "carriers_standard", label: "Standard carriers" },
  { k: "carriers_cheap",    label: "Cheap carriers" },
  { k: "carriers_nonstandard", label: "Non-standard carriers" },
];

function AdminScoringPage() {
  const { user, loading } = useAuth();
  const isAdmin = useHasRole("admin");
  const navigate = useNavigate();
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
      {!isAdmin ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Admin access required.</CardContent>
        </Card>
      ) : (
        <Inner />
      )}
    </AppShell>
  );
}

function Inner() {
  const qc = useQueryClient();
  const getW = useServerFn(getScoringWeights);
  const setW = useServerFn(updateScoringWeights);
  const getDist = useServerFn(getScoreDistribution);

  const weightsQ = useQuery({ queryKey: ["scoring-weights"], queryFn: () => getW() });
  const distQ = useQuery({ queryKey: ["scoring-distribution"], queryFn: () => getDist() });

  const [draft, setDraft] = useState<Record<string, number | string[]>>({});
  useEffect(() => {
    if (weightsQ.data?.weights) setDraft(weightsQ.data.weights);
  }, [weightsQ.data]);

  const saveM = useMutation({
    mutationFn: () => setW({ data: { weights: draft } }),
    onSuccess: () => {
      toast.success("Weights saved · scores recomputing");
      qc.invalidateQueries({ queryKey: ["scoring-weights"] });
      qc.invalidateQueries({ queryKey: ["scoring-distribution"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const dirty = useMemo(() => {
    const orig = weightsQ.data?.weights ?? {};
    return Object.keys(draft).some((k) => JSON.stringify(draft[k]) !== JSON.stringify(orig[k]));
  }, [draft, weightsQ.data]);

  const resetDefaults = () => {
    if (weightsQ.data?.defaults) setDraft({ ...weightsQ.data.defaults });
  };

  return (
    <>
      <PageHeader
        title="Lead Scoring"
        description="Tune how leads are ranked. Saving recomputes scores across all leads."
      />

      {/* Distribution */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Score distribution</h3>
            <div className="flex gap-1">
              {(["S", "A", "B", "C"] as const).map((t) => (
                <Badge key={t} variant="outline" className="gap-1">
                  <span className="font-semibold">{t}</span>
                  <span className="text-muted-foreground">{tierLabel(t)}</span>
                  <span className="tabular-nums">{distQ.data?.tiers?.[t] ?? 0}</span>
                </Badge>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {(distQ.data?.buckets ?? []).map((b) => {
              const total = b.live + b.list;
              const max = Math.max(1, ...(distQ.data?.buckets ?? []).map((x) => x.live + x.list));
              const pct = Math.round((total / max) * 100);
              const mid = Number(b.bucket.split("-")[0]) + 10;
              return (
                <div key={b.bucket} className="space-y-1">
                  <div className="h-24 bg-muted rounded-md relative overflow-hidden">
                    <div
                      className={`absolute bottom-0 inset-x-0 ${scoreBandClass(mid)}`}
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                  <div className="text-center">
                    <div className="text-xs font-medium">{b.bucket}</div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {b.live} live · {b.list} list
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 pt-1 text-xs text-muted-foreground">
            <span>Preview:</span>
            <LeadScoreChip score={92} tier="S" size="xs" />
            <LeadScoreChip score={74} tier="A" size="xs" />
            <LeadScoreChip score={55} tier="B" size="xs" />
            <LeadScoreChip score={28} tier="C" size="xs" />
          </div>
        </CardContent>
      </Card>

      {/* Editor */}
      <Card className="mt-4">
        <CardContent className="p-4 space-y-6">
          {WEIGHT_GROUPS.map((g) => (
            <section key={g.title} className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</h4>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.keys.map(({ k, label, help }) => (
                  <div key={k} className="space-y-1">
                    <Label htmlFor={k} className="text-xs">{label}</Label>
                    <Input
                      id={k}
                      type="number"
                      value={(draft[k] as number) ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [k]: Number(e.target.value) }))
                      }
                    />
                    {help && <p className="text-[11px] text-muted-foreground">{help}</p>}
                  </div>
                ))}
              </div>
            </section>
          ))}

          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Carrier tiering</h4>
            <p className="text-[11px] text-muted-foreground">
              Expensive carriers are easier to switch, so they should score higher than low-cost competitors.
              Edit the points and which carriers fall in each bucket. Unknown carriers (not in any list) use the unknown pts value.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CARRIER_PTS.map(({ k, label, help }) => (
                <div key={k} className="space-y-1">
                  <Label htmlFor={k} className="text-xs">{label}</Label>
                  <Input
                    id={k}
                    type="number"
                    value={(draft[k] as number) ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [k]: Number(e.target.value) }))}
                  />
                  <p className="text-[11px] text-muted-foreground">{help}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              {CARRIER_LISTS.map(({ k, label }) => {
                const arr = Array.isArray(draft[k]) ? (draft[k] as string[]) : [];
                return (
                  <div key={k} className="space-y-1">
                    <Label htmlFor={k} className="text-xs">{label}</Label>
                    <Textarea
                      id={k}
                      rows={4}
                      value={arr.join(", ")}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          [k]: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        }))
                      }
                    />
                    <p className="text-[11px] text-muted-foreground">Comma-separated. {arr.length} carriers.</p>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="flex items-center justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={resetDefaults} disabled={saveM.isPending}>
              Reset to defaults
            </Button>
            <Button onClick={() => saveM.mutate()} disabled={!dirty || saveM.isPending}>
              {saveM.isPending ? "Saving…" : "Save & recompute"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}