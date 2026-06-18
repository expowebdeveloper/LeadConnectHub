import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DISPO_OPTIONS, type Dispo } from "@/lib/constants";
import { dispoRequiresPremium } from "@/lib/closeGuard";
import { useDispoOptions } from "@/hooks/useDispoOptions";
import { toast } from "sonner";
import { X, Archive, CalendarClock } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  table: "leads" | "list_leads";
  selectedIds: string[];
  selectedClaimMap?: Map<string, string | null>;
  onClear: () => void;
  agents: Array<{ id: string; full_name: string | null; email: string }>;
  currentUserId: string;
  isAdmin: boolean;
  /**
   * Optional set of ids within `selectedIds` that actually belong to the
   * `list_leads` table rather than `table`. Used by the archive view, which
   * merges missed-transfer rows from `list_leads` into the displayed leads
   * list. Without this, bulk updates against those rows would silently
   * affect 0 rows.
   */
  listLeadIds?: Set<string>;
};

export function BulkActionBar({ table, selectedIds, selectedClaimMap, onClear, agents, currentUserId, isAdmin, listLeadIds }: Props) {
  const qc = useQueryClient();
  const { options: dispoOptions } = useDispoOptions();
  const [dispoVal, setDispoVal] = useState<string>("");
  const [agentVal, setAgentVal] = useState<string>("");
  const [followAt, setFollowAt] = useState<string>("");
  // Which side(s) a bulk follow-up date applies to. Previously this only
  // patched the auto columns, which meant home-only selections silently did
  // nothing.
  const [followSide, setFollowSide] = useState<"auto" | "home" | "both">("both");
  const [confirmReleaseSoldCount, setConfirmReleaseSoldCount] = useState<number | null>(null);
  const [pendingPremiumDispo, setPendingPremiumDispo] = useState<Dispo | null>(null);
  const [premiumAmount, setPremiumAmount] = useState<string>("");

  const buildClaimPatch = () => ({
    claimed_by: currentUserId,
    claimed_at: new Date().toISOString(),
    agent_id: currentUserId,
  });

  const splitUnclaimedIds = () => {
    const { primary, listLead } = splitIds();
    const primaryUnclaimed = primary.filter((id) => !selectedClaimMap?.get(id));
    const listLeadUnclaimed = listLead.filter((id) => !selectedClaimMap?.get(id));
    return { primaryUnclaimed, listLeadUnclaimed };
  };

  const claimUnclaimedSelections = async () => {
    if (!currentUserId) return 0;
    const { primaryUnclaimed, listLeadUnclaimed } = splitUnclaimedIds();
    const claimPatch = buildClaimPatch();
    const claimedPrimary = await updateTable(table, primaryUnclaimed, claimPatch);
    const claimedListLead = await updateTable("list_leads", listLeadUnclaimed, claimPatch);
    return claimedPrimary + claimedListLead;
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [table] });
    if (listLeadIds && listLeadIds.size > 0) {
      qc.invalidateQueries({ queryKey: ["list_leads"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    }
  };

  const splitIds = () => {
    if (!listLeadIds || listLeadIds.size === 0) {
      return { primary: selectedIds, listLead: [] as string[] };
    }
    const primary: string[] = [];
    const listLead: string[] = [];
    for (const id of selectedIds) {
      if (listLeadIds.has(id)) listLead.push(id);
      else primary.push(id);
    }
    return { primary, listLead };
  };

  const updateTable = async (
    targetTable: "leads" | "list_leads",
    ids: string[],
    patch: Record<string, unknown>,
  ) => {
    if (ids.length === 0) return 0;
    const { data, error } = await (supabase.from(targetTable) as any)
      .update(patch)
      .in("id", ids)
      .select("id");
    if (error) throw error;
    return Array.isArray(data) ? data.length : 0;
  };

  const runOnBoth = async (patch: Record<string, unknown>) => {
    const { primary, listLead } = splitIds();
    const updatedPrimary = await updateTable(table, primary, patch);
    const updatedListLead = await updateTable("list_leads", listLead, patch);
    return updatedPrimary + updatedListLead;
  };

  const releaseM = useMutation({
    mutationFn: () => runOnBoth({ claimed_by: null, claimed_at: null, agent_id: null }),
    onSuccess: () => {
      toast.success(`Released ${selectedIds.length} lead${selectedIds.length === 1 ? "" : "s"}`);
      invalidate();
      onClear();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to release"),
  });

  const startRelease = async () => {
    try {
      const { primary, listLead } = splitIds();
      const counts: number[] = [];
      const check = async (tbl: "leads" | "list_leads", ids: string[]) => {
        if (ids.length === 0) return;
        const { data } = await (supabase.from(tbl) as any)
          .select("id, dispo, home_dispo")
          .in("id", ids);
        for (const r of data ?? []) {
          if (r.dispo === "sold") counts.push(1);
          if (r.home_dispo === "sold") counts.push(1);
        }
      };
      await check(table, primary);
      await check("list_leads", listLead);
      if (counts.length > 0) {
        setConfirmReleaseSoldCount(counts.length);
        return;
      }
      releaseM.mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to check selection");
    }
  };

  const dispoM = useMutation({
    mutationFn: async ({ d, premium }: { d: Dispo; premium?: number }) => {
      // Bulk-setting follow_up or x_date without a date silently strands the
      // lead off everyone's calendar. The popover next to this control
      // captures the date — point the user there instead.
      if (d === "follow_up") {
        throw new Error("Use the Follow-up button to bulk-set a follow-up date.");
      }
      if (d === "x_date") {
        throw new Error("Open a lead to set an X-date — it requires a specific renewal date.");
      }
      if (!isAdmin) await claimUnclaimedSelections();
      // The early-returns above guarantee d is neither follow_up nor x_date,
      // so always clear both scheduled date columns.
      const patch: Record<string, unknown> = {
        dispo: d,
        follow_up_at: null,
        x_date: null,
      };
      if (premium !== undefined) {
        patch.quoted_premium = premium;
      }
      const updated = await runOnBoth(patch);
      if (updated === 0) throw new Error("No selected leads were updated.");
      return updated;
    },
    onSuccess: (updated) => {
      toast.success(`Updated dispo on ${updated} lead${updated === 1 ? "" : "s"}`);
      invalidate();
      setDispoVal("");
      setPendingPremiumDispo(null);
      setPremiumAmount("");
      onClear();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update dispo"),
  });

  const handleDispoSelect = (v: string) => {
    const d = v as Dispo;
    setDispoVal(v);
    if (d === "follow_up") {
      toast.error("Use the Follow-up button to bulk-set a follow-up date.");
      setDispoVal("");
      return;
    }
    if (d === "x_date") {
      toast.error("Open a lead to set an X-date — it requires a specific renewal date.");
      setDispoVal("");
      return;
    }
    if (dispoRequiresPremium(d)) {
      setPendingPremiumDispo(d);
      setPremiumAmount("");
      return;
    }
    dispoM.mutate({ d });
  };

  const reassignM = useMutation({
    mutationFn: (newAgent: string) => {
      const payload = isAdmin
        ? { agent_id: newAgent, claimed_by: newAgent, claimed_at: new Date().toISOString() }
        : { agent_id: newAgent };
      return runOnBoth(payload as Record<string, unknown>);
    },
    onSuccess: () => {
      toast.success(`Reassigned ${selectedIds.length} lead${selectedIds.length === 1 ? "" : "s"}`);
      invalidate();
      setAgentVal("");
      onClear();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to reassign"),
  });

  const archiveM = useMutation({
    mutationFn: async () => {
      // `archived_at` only exists on the `leads` table; missed-transfer rows
      // from `list_leads` are already in the archive conceptually.
      const { primary } = splitIds();
      if (primary.length === 0) return;
      const { error } = await supabase
        .from(table)
        .update({ archived_at: new Date().toISOString() } as never)
        .in("id", primary);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Archived ${selectedIds.length} lead${selectedIds.length === 1 ? "" : "s"}`);
      invalidate();
      onClear();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to archive"),
  });

  const followUpM = useMutation({
    mutationFn: async ({ iso, side }: { iso: string; side: "auto" | "home" | "both" }) => {
      if (!isAdmin) await claimUnclaimedSelections();
      const patch: Record<string, unknown> = {};
      if (side === "auto" || side === "both") {
        patch.dispo = "follow_up" as Dispo;
        patch.follow_up_at = iso;
        patch.x_date = null;
      }
      if (side === "home" || side === "both") {
        patch.home_dispo = "follow_up" as Dispo;
        patch.home_follow_up_at = iso;
        patch.home_x_date = null;
      }
      const updated = await runOnBoth(patch);
      if (updated === 0) throw new Error("No selected leads were updated.");
      return updated;
    },
    onSuccess: (updated) => {
      toast.success(`Set follow-up on ${updated} lead${updated === 1 ? "" : "s"}`);
      invalidate();
      setFollowAt("");
      onClear();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to set follow-up"),
  });

  if (selectedIds.length === 0) return null;

  return (
    <div className="sticky bottom-4 z-30 mx-auto mt-4 flex w-fit max-w-full items-center gap-3 rounded-lg border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
      <span className="text-sm font-medium">{selectedIds.length} selected</span>
      <div className="h-5 w-px bg-border" />
      <Button size="sm" variant="outline" onClick={startRelease} disabled={releaseM.isPending}>
        Release
      </Button>
      <Select value={dispoVal} onValueChange={handleDispoSelect}>
        <SelectTrigger className="h-8 w-40"><SelectValue placeholder="Change dispo…" /></SelectTrigger>
        <SelectContent>
          {dispoOptions.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {isAdmin && (
        <Select value={agentVal} onValueChange={(v) => { setAgentVal(v); reassignM.mutate(v); }}>
          <SelectTrigger className="h-8 w-48"><SelectValue placeholder="Reassign to…" /></SelectTrigger>
          <SelectContent>
            {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.full_name || a.email}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1">
            <CalendarClock className="h-3.5 w-3.5" /> Follow-up
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-2">
          <Label className="text-xs">Follow-up at</Label>
          <Input type="datetime-local" value={followAt} onChange={(e) => setFollowAt(e.target.value)} />
          <div className="flex items-center gap-1">
            <Label className="text-xs flex-1">Apply to</Label>
            <div className="flex rounded-md border bg-background p-0.5">
              {(["auto", "home", "both"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFollowSide(s)}
                  className={
                    "px-2 py-0.5 text-xs rounded " +
                    (followSide === s
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted")
                  }
                >
                  {s === "auto" ? "Auto" : s === "home" ? "Home" : "Both"}
                </button>
              ))}
            </div>
          </div>
          <Button
            size="sm"
            className="w-full"
            disabled={!followAt || followUpM.isPending}
            onClick={() =>
              followUpM.mutate({
                iso: new Date(followAt).toISOString(),
                side: followSide,
              })
            }
          >
            Set on {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"}
          </Button>
        </PopoverContent>
      </Popover>
      <Button size="sm" variant="outline" className="gap-1" onClick={() => archiveM.mutate()} disabled={archiveM.isPending}>
        <Archive className="h-3.5 w-3.5" /> Archive
      </Button>
      <button onClick={onClear} className="ml-1 rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Clear selection">
        <X className="h-4 w-4" />
      </button>
      <AlertDialog
        open={confirmReleaseSoldCount !== null}
        onOpenChange={(o) => !o && setConfirmReleaseSoldCount(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release sold leads?</AlertDialogTitle>
            <AlertDialogDescription>
              Your selection includes <strong>{confirmReleaseSoldCount}</strong> sold side
              {confirmReleaseSoldCount === 1 ? "" : "s"}. Releasing will remove ownership and
              drop those sales from commission totals and leaderboards until someone re-claims them.
              <br />
              <br />
              Are you sure you want to release the full selection?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmReleaseSoldCount(null);
                releaseM.mutate();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, release all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={pendingPremiumDispo !== null}
        onOpenChange={(o) => {
          if (!o) {
            setPendingPremiumDispo(null);
            setDispoVal("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enter Premium Amount</AlertDialogTitle>
            <AlertDialogDescription>
              The <strong>{dispoOptions.find((o) => o.value === pendingPremiumDispo)?.label ?? pendingPremiumDispo}</strong> disposition requires a valid premium amount.
              This premium will be applied to all {selectedIds.length} selected leads.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Label>Premium ($)</Label>
            <Input 
              type="number" 
              placeholder="0" 
              value={premiumAmount} 
              onChange={(e) => setPremiumAmount(e.target.value)} 
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const n = Number(premiumAmount);
                  if (n > 0) {
                    dispoM.mutate({ d: pendingPremiumDispo!, premium: n });
                  } else {
                    toast.error("Please enter a valid premium amount greater than 0");
                  }
                }
              }}
              autoFocus 
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                const n = Number(premiumAmount);
                if (!premiumAmount || isNaN(n) || n <= 0) {
                  e.preventDefault();
                  toast.error("Please enter a valid premium amount greater than 0");
                  return;
                }
                dispoM.mutate({ d: pendingPremiumDispo!, premium: n });
              }}
              disabled={dispoM.isPending}
            >
              Save Dispo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}