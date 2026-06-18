import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getScoringWeights, updateScoringWeights, getScoreDistribution } from "@/lib/scoring.functions";
import { LeadScoreChip, scoreBandClass, tierLabel } from "@/components/LeadScoreChip";
import { toast } from "sonner";

const WEIGHT_GROUPS: { title: string; keys: { k: string; label: string; help?: string }[] }[] = [
  {
    title: "Per-side components (auto + home)",
    keys: [
      { k: "vehicle_per_unit", label: "Points per vehicle", help: "15 = each vehicle adds 15 pts (dominant ranking factor)" },
      { k: "vehicle_cap", label: "Vehicle cap", help: "Max vehicle points (150 = up to 10 vehicles count fully)" },
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
      { k: "tier_winback_bonus", label: "A · Win-back bonus cap", help: "Maximum bonus a winback can receive." },
      { k: "tier_winback_base", label: "A · Win-back base", help: "Flat bonus once a winback has ≥1 auto." },
      { k: "tier_winback_per_vehicle", label: "A · Win-back pts per vehicle", help: "Adds this much per auto on file (zero autos = no bonus)." },
      { k: "tier_requote_bonus", label: "B · Requote bonus" },
      { k: "tier_aged_penalty", label: "C · Aged-source penalty (negative)", help: "Applied only to leads labeled 'Aged' at the source (lead_source/list_type = aged)." },
    ],
  },
  {
    title: "Recent contact boost",
    keys: [
      { k: "recent_contact_bonus", label: "Recent contact bonus", help: "Extra points added to a lead dialed in the last N days. Keeps actively-worked leads at the top regardless of car count. Decays linearly to 0 at the edge of the window." },
      { k: "recent_contact_days", label: "Recent contact window (days)", help: "How recently the lead must have been contacted to qualify for the bonus." },
      { k: "fresh_upload_bonus", label: "Fresh upload bonus", help: "Extra points added to leads created in the last N days. Surfaces freshly uploaded inventory. Decays linearly to 0 at the edge of the window." },
      { k: "fresh_upload_days", label: "Fresh upload window (days)", help: "How recently the lead must have been created to qualify for the bonus." },
    ],
  },
  {
    title: "Shark tank penalties",
    keys: [
      { k: "no_connect_recover_pct_per_day", label: "No-connect recovery (% per day)", help: "A failed call attempt (voicemail, busy, no answer, callback requested) drops the score by 100%. The score recovers this percentage each day since the last failed attempt. 1% per day = fully restored after 100 days. A connected call resets immediately." },
      { k: "release_penalty_per", label: "Release penalty per release", help: "Points deducted each time a lead is released back to the tank." },
      { k: "release_penalty_cap", label: "Release penalty cap" },
      { k: "release_penalty_decay_days", label: "Release decay (days)" },
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

const HOME_KEYS: { k: string; label: string; help: string }[] = [
  { k: "home_age_max", label: "Home age (max pts)", help: "Full points if built within 10y, linear decay to 0 at 80y." },
  { k: "home_value_max", label: "Dwelling value (max pts)", help: "0 at ≤$150k, linear to full at ≥$600k. Pricier homes score higher." },
  { k: "home_roof_max", label: "Roof recency (max pts)", help: "Full if roof ≤5y, linear to 0 at 30y. Newer roofs are easier to insure." },
  { k: "home_construction_masonry_pts", label: "Masonry / brick / block pts", help: "Awarded when construction type is masonry, brick, block, concrete, stucco, or cinder." },
  { k: "home_construction_frame_pts", label: "Frame / wood pts", help: "Awarded when construction type is frame, wood, vinyl, or siding." },
  { k: "home_flood_high_pts", label: "High flood-zone pts", help: "Flood zones A* or V* add this many points — flood-zone homes need flood premiums and convert well." },
  { k: "home_flood_low_pts", label: "Low flood-zone pts", help: "Zones X / B / C / D add this many points (usually 0)." },
  { k: "home_size_max", label: "Large home bonus (max pts)", help: "Bonus that scales from 2,000 sq ft up to 4,000+ sq ft." },
  { k: "home_liability_penalty", label: "Pool / trampoline penalty", help: "Subtracted when the property has a pool or trampoline on file." },
];

export function ScoringEditor() {
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

      <Card className="mt-4">
        <CardContent className="p-4 space-y-6">
        <Tabs defaultValue="auto" className="space-y-4">
          <TabsList>
            <TabsTrigger value="auto">Auto</TabsTrigger>
            <TabsTrigger value="home">Home</TabsTrigger>
          </TabsList>
          <TabsContent value="auto" className="space-y-6">
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
          </TabsContent>

          <TabsContent value="home" className="space-y-6">
            <section className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Home property signals</h4>
              <p className="text-[11px] text-muted-foreground">
                The Home shark tank scores leads independently of vehicle count. Newer, higher-value
                homes with newer roofs and masonry construction score highest. Flood-zone homes are
                worth pursuing because they need flood premiums; pool/trampoline properties carry a
                small liability penalty.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {HOME_KEYS.map(({ k, label, help }) => (
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
              <p className="text-[11px] text-muted-foreground">
                Home leads also use the shared carrier tiering, age band, recency, and contactability
                values from the Auto tab.
              </p>
            </section>
          </TabsContent>
        </Tabs>

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