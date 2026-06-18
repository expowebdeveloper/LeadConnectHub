import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Loader2, Plus, Trash2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useSettings, useUpdateSetting } from "@/lib/settings";
import {
  DEFAULT_COMMISSION_CONFIG,
  type CommissionConfig,
} from "@/lib/commissions";

type Tier = CommissionConfig["homieTiers"][number];

export function CommissionsSettings() {
  const { data, isLoading } = useSettings();
  const update = useUpdateSetting();
  const [draft, setDraft] = useState<CommissionConfig>(DEFAULT_COMMISSION_CONFIG);

  useEffect(() => {
    if (data?.commissions) setDraft(data.commissions);
  }, [data?.commissions]);

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.commissions);

  const save = () =>
    update.mutate(
      { key: "commissions", value: draft },
      {
        onSuccess: () => toast.success("Commission settings saved"),
        onError: (e: unknown) =>
          toast.error(e instanceof Error ? e.message : "Failed to save"),
      },
    );

  const setNum =
    <K extends keyof CommissionConfig>(key: K) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setDraft({ ...draft, [key]: Number(e.target.value) || 0 } as CommissionConfig);

  const setClub = (
    club: "club38" | "club49",
    field: "autos" | "others" | "bonus",
  ) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft({
      ...draft,
      [club]: { ...draft[club], [field]: Number(e.target.value) || 0 },
    });

  const updateTier = (idx: number, patch: Partial<Tier>) => {
    const next = [...draft.homieTiers];
    next[idx] = { ...next[idx], ...patch };
    setDraft({ ...draft, homieTiers: next });
  };

  const addTier = () =>
    setDraft({
      ...draft,
      homieTiers: [
        ...draft.homieTiers,
        { min: 0, rate: 0, label: "New tier" },
      ],
    });

  const removeTier = (idx: number) =>
    setDraft({
      ...draft,
      homieTiers: draft.homieTiers.filter((_, i) => i !== idx),
    });

  const resetAll = () => setDraft(DEFAULT_COMMISSION_CONFIG);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Service plan</CardTitle>
          <CardDescription>
            Flat-rate commission for service agents. Allstate policies have a
            minimum dollar payout per policy.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Service rate (decimal, e.g. 0.02 = 2%)"
            value={draft.serviceRate}
            step="0.001"
            onChange={setNum("serviceRate")}
          />
          <Field
            label="Allstate per-policy minimum ($)"
            value={draft.allstateServiceMin}
            step="1"
            onChange={setNum("allstateServiceMin")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Homie plan — Allstate bonuses</CardTitle>
          <CardDescription>
            Flat dollar bonus per Allstate item (excludes flood / BOP).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Monoline bonus ($ per item)"
            value={draft.allstateBonusMonoline}
            step="1"
            onChange={setNum("allstateBonusMonoline")}
          />
          <Field
            label="Bundled bonus ($ per item)"
            value={draft.allstateBonusBundled}
            step="1"
            onChange={setNum("allstateBonusBundled")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Homie plan — Premium tiers</CardTitle>
          <CardDescription>
            Tiers are applied to commissionable premium (total minus Allstate
            Auto). Highest matching <code>min</code> wins.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 px-1 text-xs font-medium text-muted-foreground">
            <div>Label</div>
            <div>Min premium ($)</div>
            <div>Rate (decimal)</div>
            <div />
          </div>
          {draft.homieTiers.map((t, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2"
            >
              <Input
                value={t.label}
                onChange={(e) => updateTier(i, { label: e.target.value })}
              />
              <Input
                type="number"
                value={t.min}
                step="1000"
                onChange={(e) =>
                  updateTier(i, { min: Number(e.target.value) || 0 })
                }
              />
              <Input
                type="number"
                value={t.rate}
                step="0.005"
                onChange={(e) =>
                  updateTier(i, { rate: Number(e.target.value) || 0 })
                }
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeTier(i)}
                aria-label="Remove tier"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addTier}>
            <Plus className="mr-1 h-4 w-4" /> Add tier
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Autobot plan</CardTitle>
          <CardDescription>
            Allstate rate ladders up by step every N items, capped. Non-Allstate
            is a flat rate.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Base Allstate rate (decimal)"
            value={draft.autobotBaseRate}
            step="0.005"
            onChange={setNum("autobotBaseRate")}
          />
          <Field
            label="Tier step (decimal)"
            value={draft.autobotTierStep}
            step="0.005"
            onChange={setNum("autobotTierStep")}
          />
          <Field
            label="Items per tier bump"
            value={draft.autobotItemsPerTier}
            step="1"
            onChange={setNum("autobotItemsPerTier")}
          />
          <Field
            label="Allstate rate cap (decimal)"
            value={draft.autobotTierCap}
            step="0.005"
            onChange={setNum("autobotTierCap")}
          />
          <Field
            label="Non-Allstate rate (decimal)"
            value={draft.autobotNonAllstateRate}
            step="0.005"
            onChange={setNum("autobotNonAllstateRate")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Autobot — Club bonuses</CardTitle>
          <CardDescription>
            One-time bonus when both thresholds are met within the period.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ClubRow
            name="Club 38"
            club={draft.club38}
            onChange={setClub.bind(null, "club38")}
          />
          <Separator />
          <ClubRow
            name="Club 49"
            club={draft.club49}
            onChange={setClub.bind(null, "club49")}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={resetAll} disabled={update.isPending}>
          <RotateCcw className="mr-1 h-4 w-4" /> Reset to defaults
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => data && setDraft(data.commissions)}
            disabled={!dirty || update.isPending}
          >
            Discard
          </Button>
          <Button onClick={save} disabled={!dirty || update.isPending}>
            {update.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step?: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <Input type="number" value={value} step={step} onChange={onChange} />
    </div>
  );
}

function ClubRow({
  name,
  club,
  onChange,
}: {
  name: string;
  club: { autos: number; others: number; bonus: number };
  onChange: (
    field: "autos" | "others" | "bonus",
  ) => (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{name}</div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Allstate auto items" value={club.autos} step="1" onChange={onChange("autos")} />
        <Field label="Allstate other items" value={club.others} step="1" onChange={onChange("others")} />
        <Field label="Bonus ($)" value={club.bonus} step="10" onChange={onChange("bonus")} />
      </div>
    </div>
  );
}