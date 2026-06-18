import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useHasRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  DISPO_OPTIONS,
  type Dispo,
  SCRIPT_TYPES,
  type ScriptType,
  EXISTING_CLIENT_LINE_OPTIONS,
} from "@/lib/constants";
import { useDispoOptions } from "@/hooks/useDispoOptions";
import { toast } from "sonner";
import { dispoRequiresPremium } from "@/lib/closeGuard";
import { Home, Car, Lock, Unlock, Key } from "lucide-react";
import { CalendarIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { SaleTypeDialog, type SaleType } from "./SaleTypeDialog";
import { LeadScriptButton } from "./LeadScriptButton";
import { LeadNotesThread } from "./LeadNotesThread";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
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

export type HousingStatus = "homeowner" | "renter" | null;
export type LeadSide = "auto" | "home";
export type LeadSource = "leads" | "list_leads";

// ---- X-date picker (Shadcn Popover + Calendar) -------------------------------
// Native <input type="date"> is unreliable inside Radix AlertDialogs (focus
// trap / pointer-events suppress the OS calendar popup). Use the Shadcn
// pattern with `pointer-events-auto` so it works inside dialogs.
function ymdToDate(s: string | null | undefined): Date | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
function dateToYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function formatYmdHuman(s: string): string {
  const d = ymdToDate(s);
  if (!d) return "Pick a date";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
function XDatePicker({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = ymdToDate(value);
  // Typed text input — accepts MM/DD/YYYY. Calendar stays as a click fallback.
  const ymdToMdy = (s: string): string => {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return "";
    return `${m[2]}/${m[3]}/${m[1]}`;
  };
  const [typed, setTyped] = useState(ymdToMdy(value));
  const [typedError, setTypedError] = useState(false);
  useEffect(() => {
    setTyped(ymdToMdy(value));
    setTypedError(false);
  }, [value]);
  const commitTyped = (raw: string) => {
    const t = raw.trim();
    if (!t) {
      setTypedError(false);
      if (value) onChange("");
      return;
    }
    const m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
    if (!m) {
      setTypedError(true);
      return;
    }
    let [, mo, day, yr] = m;
    if (yr.length === 2) yr = (Number(yr) >= 70 ? "19" : "20") + yr;
    const moN = Number(mo), dN = Number(day), yN = Number(yr);
    const d = new Date(Date.UTC(yN, moN - 1, dN));
    if (
      d.getUTCFullYear() !== yN ||
      d.getUTCMonth() !== moN - 1 ||
      d.getUTCDate() !== dN
    ) {
      setTypedError(true);
      return;
    }
    setTypedError(false);
    onChange(dateToYmd(d));
  };
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="flex-1">
        <Input
          type="text"
          inputMode="numeric"
          placeholder="MM/DD/YYYY"
          value={typed}
          autoFocus={autoFocus}
          onChange={(e) => {
            setTyped(e.target.value);
            if (typedError) setTypedError(false);
          }}
          onBlur={(e) => commitTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTyped((e.target as HTMLInputElement).value);
            }
          }}
          className={cn(
            "h-10 rounded-lg bg-background/60",
            typedError && "border-destructive focus-visible:ring-destructive",
          )}
        />
        {typedError && (
          <p className="mt-1 text-[11px] text-destructive">
            Use MM/DD/YYYY (e.g. 06/15/2027).
          </p>
        )}
      </div>
      <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          // Safety net: Radix occasionally leaves body pointer-events locked.
          setTimeout(() => {
            if (document.body.style.pointerEvents === "none") {
              document.body.style.pointerEvents = "";
            }
            document.body.removeAttribute("data-scroll-locked");
          }, 0);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-10 justify-start text-left font-normal sm:w-[160px]",
            !selected && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="h-4 w-4" />
          <span className="sr-only">Pick date from calendar</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 pointer-events-auto"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            if (d) {
              onChange(dateToYmd(d));
              setOpen(false);
            }
          }}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
      </Popover>
    </div>
  );
}

// ---- Follow-up picker (date + time, dialog-safe) ----------------------------
// Stored as ISO datetime in DB. Local form value is "YYYY-MM-DDTHH:mm".
function splitLocal(v: string): { ymd: string; hm: string } {
  if (!v) return { ymd: "", hm: "09:00" };
  const [d, t] = v.split("T");
  return { ymd: d ?? "", hm: (t ?? "09:00").slice(0, 5) };
}
function combineLocal(ymd: string, hm: string): string {
  if (!ymd) return "";
  return `${ymd}T${hm || "09:00"}`;
}
function ymdLocalToDate(s: string): Date | undefined {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}
function dateToYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function formatLocalHuman(v: string): string {
  const { ymd, hm } = splitLocal(v);
  const d = ymdLocalToDate(ymd);
  if (!d) return "Pick a date & time";
  const [hh, mm] = hm.split(":").map(Number);
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
function FollowUpPicker({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const { ymd, hm } = splitLocal(value);
  const [open, setOpen] = useState(false);
  const selected = ymdLocalToDate(ymd);
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setTimeout(() => {
              if (document.body.style.pointerEvents === "none") {
                document.body.style.pointerEvents = "";
              }
              document.body.removeAttribute("data-scroll-locked");
            }, 0);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            autoFocus={autoFocus}
            className={cn(
              "flex-1 justify-start text-left font-normal",
              !selected && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {selected
              ? selected.toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })
              : "Pick a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto p-0 pointer-events-auto"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => {
              if (d) {
                onChange(combineLocal(dateToYmdLocal(d), hm || "09:00"));
                setOpen(false);
              }
            }}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
      <Input
        type="time"
        value={hm}
        onChange={(e) => onChange(combineLocal(ymd, e.target.value))}
        className="w-full sm:w-32"
      />
    </div>
  );
}
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------

export type SideState = {
  dispo: Dispo | null;
  claimed_by: string | null;
  quoted_premium: number | null;
  policies_count: number;
  follow_up_at: string | null;
  x_date: string | null;
  agent_notes: string | null;
  sale_type?: SaleType | null;
};

const COLS = {
  auto: {
    dispo: "dispo",
    claimed_by: "claimed_by",
    quoted_premium: "quoted_premium",
    policies_count: "auto_policies_count",
    follow_up_at: "follow_up_at",
    x_date: "x_date",
    agent_notes: "agent_notes",
    claimed_at: "claimed_at",
    sale_type: "auto_sale_type",
  },
  home: {
    dispo: "home_dispo",
    claimed_by: "home_claimed_by",
    quoted_premium: "home_quoted_premium",
    policies_count: "home_policies_count",
    follow_up_at: "home_follow_up_at",
    x_date: "home_x_date",
    agent_notes: "home_agent_notes",
    claimed_at: "home_claimed_at",
    sale_type: "home_sale_type",
  },
} as const;

/**
 * One side (Auto or Home) of a lead's working state. Independent claim, dispo,
 * premium, policies count, follow-up, x-date and notes. Gated on housing_status
 * being set — without it, dispo edits are blocked.
 */
export function LeadSidePane({
  leadId,
  source,
  side,
  housingStatus,
  state,
  scriptType,
  invalidateKeys = [],
}: {
  leadId: string;
  source: LeadSource;
  side: LeadSide;
  housingStatus: HousingStatus;
  state: SideState;
  scriptType?: ScriptType;
  invalidateKeys?: readonly unknown[][];
}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const isAdmin = useHasRole("admin");
  const qc = useQueryClient();
  const cols = COLS[side];
  const sideLabel =
    side === "auto" ? "Auto" : housingStatus === "renter" ? "Renters" : "Home";
  const Icon = side === "auto" ? Car : Home;
  const { options: dispoOptions } = useDispoOptions();

  const claimedByMe = state.claimed_by && state.claimed_by === userId;
  // Agents the lead is shared with can edit either side without stealing the
  // claim from the original owner.
  const shareAccessQ = useQuery({
    queryKey: ["lead-share-access", source, leadId, userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_shares")
        .select("id")
        .eq("lead_id", leadId)
        .eq("lead_table", source)
        .eq("shared_with", userId!)
        .limit(1);
      if (error) throw error;
      return data ?? [];
    },
  });
  const isSharedWithMe = (shareAccessQ.data?.length ?? 0) > 0;
  // Admin and shared agents can always edit any side regardless of claim.
  const claimedBySomeoneElse =
    !!state.claimed_by && !claimedByMe && !isAdmin && !isSharedWithMe;
  // Housing status is encouraged but no longer blocks dispo/notes editing.
  const dispoLocked = false;

  const [premium, setPremium] = useState(
    state.quoted_premium != null ? String(state.quoted_premium) : "",
  );
  const [policies, setPolicies] = useState(String(state.policies_count ?? 0));
  const [notes, setNotes] = useState(state.agent_notes ?? "");
  const [followUp, setFollowUp] = useState(
    state.follow_up_at ? state.follow_up_at.slice(0, 16) : "",
  );
  const [xDate, setXDate] = useState(state.x_date ?? "");
  const [pendingSaleDialog, setPendingSaleDialog] = useState(false);
  const [pendingUnsold, setPendingUnsold] = useState<Dispo | null>(null);
  const [confirmReleaseSold, setConfirmReleaseSold] = useState(false);
  // When non-null, the release-warning dialog is open. The reason drives the
  // copy and whether we also clear scheduled date columns on confirm so the
  // lead doesn't get stranded on no one's calendar.
  const [confirmReleaseScheduled, setConfirmReleaseScheduled] = useState<
    null | "follow_up" | "x_date"
  >(null);
  // Forced follow-up date/time picker when user selects "follow_up" dispo.
  const [pendingFollowUp, setPendingFollowUp] = useState<{ from: Dispo | null } | null>(null);
  const [pendingFollowUpAt, setPendingFollowUpAt] = useState("");
  // Forced date picker when user selects "x_date" dispo.
  const [pendingXDate, setPendingXDate] = useState<{ from: Dispo | null } | null>(null);
  const [pendingXDateAt, setPendingXDateAt] = useState("");
  // Forced premium prompt when agent picks a dispo that implies a quote was
  // given but no premium has been entered yet. After confirm, we persist the
  // premium and continue with the original dispo flow.
  const [pendingPremium, setPendingPremium] = useState<{ next: Dispo } | null>(null);
  const [pendingPremiumAmt, setPendingPremiumAmt] = useState("");
  const skipPremiumGate = useRef(false);
  // "Already a Client" prompt — captures which lines they already hold.
  const [pendingClientLines, setPendingClientLines] = useState<{
    from: Dispo | null;
  } | null>(null);
  const [clientLines, setClientLines] = useState<string[]>([]);
  // Lead-level existing client lines (loaded lazily so we can show & edit them).
  const [existingLines, setExistingLines] = useState<string[]>([]);
  const [existingLinesTick, setExistingLinesTick] = useState(0);
  // Optimistic dispo — applied immediately on save so the UI doesn't show
  // "Pick a dispo" while the parent query refetches the row.
  const [optimisticDispo, setOptimisticDispo] = useState<Dispo | null>(null);
  const effectiveDispo: Dispo | null = optimisticDispo ?? state.dispo;

  // Re-hydrate when parent data changes
  useEffect(() => {
    setPremium(state.quoted_premium != null ? String(state.quoted_premium) : "");
    setPolicies(String(state.policies_count ?? 0));
    setNotes(state.agent_notes ?? "");
    setFollowUp(state.follow_up_at ? state.follow_up_at.slice(0, 16) : "");
    setXDate(state.x_date ?? "");
  }, [
    state.quoted_premium,
    state.policies_count,
    state.agent_notes,
    state.follow_up_at,
    state.x_date,
  ]);

  // Clear the optimistic override once the parent's data catches up.
  useEffect(() => {
    if (optimisticDispo && state.dispo === optimisticDispo) {
      setOptimisticDispo(null);
    }
  }, [state.dispo, optimisticDispo]);

  const invalidate = () => {
    for (const key of invalidateKeys) {
      qc.invalidateQueries({ queryKey: key });
    }
  };

  const updateMut = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const { error } = await (supabase.from(source) as any)
        .update(patch)
        .eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setExistingLinesTick((t) => t + 1);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Save failed"),
  });

  // Load lead-level existing_client_lines (re-fetched on every save).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase.from(source) as any)
        .select("existing_client_lines")
        .eq("id", leadId)
        .maybeSingle();
      if (!cancelled) {
        setExistingLines(
          Array.isArray(data?.existing_client_lines) ? data!.existing_client_lines : [],
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId, source, existingLinesTick]);

  const claim = () => {
    updateMut.mutate({
      [cols.claimed_by]: userId,
      ...(side === "auto" ? { claimed_at: new Date().toISOString() } : {}),
    });
    // Audit so closeGuard recognises the user worked this lead even if the
    // claim is later released (e.g. busy / no-answer call outcomes).
    if (userId) {
      void supabase
        .from("lead_activities" as never)
        .insert({
          lead_id: leadId,
          lead_table: source,
          user_id: userId,
          action: "lead_claimed",
          details: { side },
        } as never)
        .then(() => undefined, () => undefined);
    }
  };
  const release = () =>
    updateMut.mutate({
      [cols.claimed_by]: null,
      ...(side === "auto" ? { claimed_at: null } : {}),
    });
  const releaseAndClearSchedule = () =>
    updateMut.mutate({
      [cols.claimed_by]: null,
      [cols.dispo]: null,
      [cols.follow_up_at]: null,
      [cols.x_date]: null,
      ...(side === "auto" ? { claimed_at: null } : {}),
    });
  const onReleaseClick = () => {
    if (effectiveDispo === "sold") {
      setConfirmReleaseSold(true);
      return;
    }
    if (effectiveDispo === "follow_up" || effectiveDispo === "x_date") {
      setConfirmReleaseScheduled(effectiveDispo);
      return;
    }
    release();
  };

  const onDispoChange = (v: Dispo) => {
    if (dispoLocked) {
      toast.warning("Set Homeowner or Renter on this lead first.");
      return;
    }
    // Block any quote-implying dispo until a premium is on file. Sold is
    // already handled by SaleTypeDialog (which requires premium) so it's
    // exempt from this gate.
    if (
      v !== "sold" &&
      dispoRequiresPremium(v) &&
      !skipPremiumGate.current &&
      state.quoted_premium == null &&
      (premium.trim() === "" || !(Number(premium) > 0))
    ) {
      setPendingPremiumAmt(premium.trim());
      setPendingPremium({ next: v });
      return;
    }
    skipPremiumGate.current = false;
    if (v === "sold") {
      setPendingSaleDialog(true);
      return;
    }
    // Guard: changing AWAY from sold erases the sale and affects commissions.
    if (effectiveDispo === "sold") {
      setPendingUnsold(v);
      return;
    }
    // Follow-up requires an explicit date/time before we persist.
    if (v === "follow_up") {
      setPendingFollowUpAt(
        state.follow_up_at ? state.follow_up_at.slice(0, 16) : "",
      );
      setPendingFollowUp({ from: effectiveDispo });
      return;
    }
    // X-Date requires a specific renewal date before we persist.
    if (v === "x_date") {
      setPendingXDateAt(state.x_date ?? "");
      setPendingXDate({ from: effectiveDispo });
      return;
    }
    // Already a Client — require which lines they already hold so we know
    // what cross-sell opportunities remain.
    if (v === "already_a_client") {
      setClientLines(existingLines);
      setPendingClientLines({ from: effectiveDispo });
      return;
    }
    const patch: Record<string, unknown> = { [cols.dispo]: v };
    patch[cols.follow_up_at] = null;
    patch[cols.x_date] = null;
    // Auto-claim this side if not yet claimed
    if (!state.claimed_by && userId) {
      patch[cols.claimed_by] = userId;
      if (side === "auto") patch["claimed_at"] = new Date().toISOString();
    }
    setOptimisticDispo(v);
    updateMut.mutate(patch);
  };

  const confirmPendingPremium = () => {
    const n = Number(pendingPremiumAmt);
    if (!Number.isFinite(n) || n <= 0) {
      toast.warning("Enter a valid quoted premium first.");
      return;
    }
    const next = pendingPremium?.next;
    setPremium(String(n));
    updateMut.mutate({ [cols.quoted_premium]: n });
    setPendingPremium(null);
    setPendingPremiumAmt("");
    if (next) {
      // Skip the gate on the re-invoke — we just persisted premium but
      // local `state.quoted_premium` won't reflect it until the parent
      // query refetches.
      skipPremiumGate.current = true;
      onDispoChange(next);
    }
  };

  const confirmUnsold = () => {
    const v = pendingUnsold;
    if (!v) return;
    if (v === "follow_up") {
      setPendingUnsold(null);
      setPendingFollowUpAt(
        state.follow_up_at ? state.follow_up_at.slice(0, 16) : "",
      );
      setPendingFollowUp({ from: effectiveDispo });
      return;
    }
    if (v === "x_date") {
      setPendingUnsold(null);
      setPendingXDateAt(state.x_date ?? "");
      setPendingXDate({ from: effectiveDispo });
      return;
    }
    if (v === "already_a_client") {
      setPendingUnsold(null);
      setClientLines(existingLines);
      setPendingClientLines({ from: effectiveDispo });
      return;
    }
    const patch: Record<string, unknown> = {
      [cols.dispo]: v,
      [cols.sale_type]: null,
    };
    if (side === "auto") patch["auto_motor_club_premium"] = null;
    patch[cols.follow_up_at] = null;
    patch[cols.x_date] = null;
    if (!state.claimed_by && userId) {
      patch[cols.claimed_by] = userId;
      if (side === "auto") patch["claimed_at"] = new Date().toISOString();
    }
    setOptimisticDispo(v);
    updateMut.mutate(patch);
    setPendingUnsold(null);
  };

  const confirmSold = ({
    saleType,
    motorClubPremium,
    premium: confirmedPremium,
  }: {
    saleType: SaleType;
    motorClubPremium?: number | null;
    premium: number;
  }) => {
    const patch: Record<string, unknown> = {
      [cols.dispo]: "sold",
      [cols.sale_type]: saleType,
      [cols.quoted_premium]: confirmedPremium,
      [cols.follow_up_at]: null,
      [cols.x_date]: null,
    };
    if (side === "auto") {
      patch["auto_motor_club_premium"] = motorClubPremium ?? null;
    }
    if (!state.claimed_by && userId) {
      patch[cols.claimed_by] = userId;
      if (side === "auto") patch["claimed_at"] = new Date().toISOString();
    }
    setOptimisticDispo("sold");
    updateMut.mutate(patch);
    setPendingSaleDialog(false);
  };

  const savePremium = () => {
    const n = premium.trim() === "" ? null : Number(premium);
    if (n != null && !Number.isFinite(n)) return;
    // Don't allow blanking the premium when the current dispo requires one.
    if (n == null && dispoRequiresPremium(effectiveDispo)) {
      toast.warning("This disposition requires a quoted premium.");
      setPremium(state.quoted_premium != null ? String(state.quoted_premium) : "");
      return;
    }
    const patch: Record<string, unknown> = { [cols.quoted_premium]: n };
    // Entering a positive premium on a side with no dispo implies "quoted".
    // Auto-claim the side too (mirrors the auto-claim block in onDispoChange)
    // so the lead surfaces in the viewer's Quoted column instead of getting
    // stuck under Claimed with a premium but no dispo.
    if (n != null && n > 0 && !effectiveDispo) {
      patch[cols.dispo] = "quoted";
      if (!state.claimed_by && userId) {
        patch[cols.claimed_by] = userId;
        if (side === "auto") patch["claimed_at"] = new Date().toISOString();
      }
      setOptimisticDispo("quoted");
    }
    updateMut.mutate(patch);
  };
  const savePolicies = () => {
    const n = Math.max(0, Math.min(20, parseInt(policies, 10) || 0));
    setPolicies(String(n));
    updateMut.mutate({ [cols.policies_count]: n });
  };
  const saveNotes = () => updateMut.mutate({ [cols.agent_notes]: notes });
  const saveFollowUp = () =>
    updateMut.mutate({
      [cols.follow_up_at]: followUp ? new Date(followUp).toISOString() : null,
    });

  const confirmFollowUp = () => {
    if (!pendingFollowUpAt) {
      toast.warning("Pick a follow-up date and time first.");
      return;
    }
    const iso = new Date(pendingFollowUpAt).toISOString();
    const patch: Record<string, unknown> = {
      [cols.dispo]: "follow_up",
      [cols.follow_up_at]: iso,
      [cols.x_date]: null,
    };
    if (effectiveDispo === "sold") {
      patch[cols.sale_type] = null;
      if (side === "auto") patch["auto_motor_club_premium"] = null;
    }
    if (!state.claimed_by && userId) {
      patch[cols.claimed_by] = userId;
      if (side === "auto") patch["claimed_at"] = new Date().toISOString();
    }
    setFollowUp(pendingFollowUpAt);
    setOptimisticDispo("follow_up");
    updateMut.mutate(patch);
    setPendingFollowUp(null);
  };
  const confirmXDate = () => {
    if (!pendingXDateAt) {
      toast.warning("Pick an X-date first.");
      return;
    }
    const patch: Record<string, unknown> = {
      [cols.dispo]: "x_date",
      [cols.x_date]: pendingXDateAt,
      [cols.follow_up_at]: null,
    };
    if (effectiveDispo === "sold") {
      patch[cols.sale_type] = null;
      if (side === "auto") patch["auto_motor_club_premium"] = null;
    }
    if (!state.claimed_by && userId) {
      patch[cols.claimed_by] = userId;
      if (side === "auto") patch["claimed_at"] = new Date().toISOString();
    }
    setXDate(pendingXDateAt);
    setOptimisticDispo("x_date");
    updateMut.mutate(patch);
    setPendingXDate(null);
  };
  const confirmClientLines = () => {
    if (clientLines.length === 0) {
      toast.warning("Pick at least one line they already have.");
      return;
    }
    const patch: Record<string, unknown> = {
      [cols.dispo]: "already_a_client",
      existing_client_lines: clientLines,
      [cols.follow_up_at]: null,
      [cols.x_date]: null,
    };
    if (effectiveDispo === "sold") {
      patch[cols.sale_type] = null;
      if (side === "auto") patch["auto_motor_club_premium"] = null;
    }
    if (!state.claimed_by && userId) {
      patch[cols.claimed_by] = userId;
      if (side === "auto") patch["claimed_at"] = new Date().toISOString();
    }
    setExistingLines(clientLines);
    setOptimisticDispo("already_a_client");
    updateMut.mutate(patch);
    setPendingClientLines(null);
  };
  const saveXDate = () => updateMut.mutate({ [cols.x_date]: xDate || null });

  return (
    <div className="rounded-xl border border-border/70 bg-card/40 p-5 shadow-2xl backdrop-blur-sm">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-2">
            <Icon className="h-4 w-4 text-cyan-400" />
          </div>
          <span className="font-semibold text-foreground">{sideLabel}</span>
          {/* Script button is shown on the lead list row, not here, to reduce clutter. */}
          {effectiveDispo && (
            <Badge variant="secondary" className="capitalize">
              {effectiveDispo.replace(/_/g, " ")}
            </Badge>
          )}
        </div>
        <div>
          {!state.claimed_by ? (
            <Button
              size="sm"
              onClick={claim}
              disabled={updateMut.isPending}
              className="h-7 gap-1 bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 font-semibold text-[11px] uppercase tracking-wider"
            >
              <Unlock className="h-3 w-3" /> Claim {sideLabel}
            </Button>
          ) : claimedByMe ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onReleaseClick}
              disabled={updateMut.isPending}
              className="h-7 gap-1 rounded-md border border-border/70 bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:border-cyan-500/40 hover:text-cyan-400"
            >
              <Lock className="h-3 w-3" /> Release
            </Button>
          ) : isAdmin ? null : (
            <Badge variant="outline" className="text-xs">
              Claimed by another agent
            </Badge>
          )}
        </div>
      </div>

      {claimedBySomeoneElse && (
        <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-900 dark:text-amber-200">
          <span className="font-medium">Claimed by another agent.</span> You must claim this side to make edits. If you claim it, the other agent will be unassigned.
        </div>
      )}

      <fieldset
        disabled={claimedBySomeoneElse || updateMut.isPending}
        className="space-y-5 disabled:opacity-90"
      >
        <div className="space-y-1.5">
          <Label className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Disposition</Label>
          <Select
            value={effectiveDispo ?? ""}
            onValueChange={(v) => onDispoChange(v as Dispo)}
            disabled={dispoLocked}
          >
            <SelectTrigger className="h-10 rounded-lg bg-background/60">
              <SelectValue placeholder={dispoLocked ? "Set Homeowner/Renter first" : "Pick a dispo"} />
            </SelectTrigger>
            <SelectContent>
              {dispoOptions.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {dispoLocked && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              <span className="font-medium">Locked:</span> Set Housing status (Homeowner or Renter) above before disposition can be changed.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Quoted premium</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={premium}
              onChange={(e) => setPremium(e.target.value)}
              onBlur={savePremium}
              placeholder="$0"
              className="h-10 rounded-lg bg-background/60"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Policies sold</Label>
            <Input
              type="number"
              min={0}
              max={20}
              value={policies}
              onChange={(e) => setPolicies(e.target.value)}
              onBlur={savePolicies}
              className="h-10 rounded-lg bg-background/60"
            />
          </div>
        </div>

        {effectiveDispo === "follow_up" && (
          <div className="space-y-1">
            <Label className="text-xs">Follow-up at</Label>
            <FollowUpPicker
              value={followUp}
              onChange={(v) => {
                setFollowUp(v);
                updateMut.mutate({
                  [cols.follow_up_at]: v ? new Date(v).toISOString() : null,
                });
              }}
            />
          </div>
        )}
        {effectiveDispo === "x_date" && (
          <div className="space-y-1">
            <Label className="text-xs">X-date</Label>
            <XDatePicker
              value={xDate}
              onChange={(v) => {
                setXDate(v);
                updateMut.mutate({ [cols.x_date]: v || null });
              }}
            />
          </div>
        )}

        {effectiveDispo === "already_a_client" && (
          <div className="space-y-1 rounded-md border border-teal-500/30 bg-teal-500/5 p-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-teal-900 dark:text-teal-200">
                Lines they already have
              </Label>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  setClientLines(existingLines);
                  setPendingClientLines({ from: effectiveDispo });
                }}
              >
                Edit
              </Button>
            </div>
            {existingLines.length === 0 ? (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                None selected — click Edit so we know what cross-sell is open.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {existingLines.map((l) => {
                  const lbl = EXISTING_CLIENT_LINE_OPTIONS.find((o) => o.value === l)?.label ?? l;
                  return (
                    <Badge key={l} variant="secondary" className="capitalize">
                      {lbl}
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <LeadNotesThread
          leadId={leadId}
          leadTable={source}
          lineKey={side}
          title={`Notes (${sideLabel})`}
        />
      </fieldset>
      <SaleTypeDialog
        open={pendingSaleDialog}
        side={side}
        defaultValue={state.sale_type ?? null}
        premium={state.quoted_premium ?? (premium.trim() === "" ? null : Number(premium))}
        onCancel={() => setPendingSaleDialog(false)}
        onConfirm={confirmSold}
      />
      <AlertDialog
        open={pendingPremium !== null}
        onOpenChange={(o) => {
          if (!o) {
            setPendingPremium(null);
            setPendingPremiumAmt("");
          }
        }}
      >
        <AlertDialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Enter quoted premium</AlertDialogTitle>
            <AlertDialogDescription>
              Before setting this disposition we need the quoted premium on
              record. Enter the {sideLabel} premium you quoted the prospect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1 py-2">
            <Label className="text-xs">Quoted premium ({sideLabel})</Label>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              autoFocus
              value={pendingPremiumAmt}
              onChange={(e) => setPendingPremiumAmt(e.target.value)}
              placeholder="$0"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmPendingPremium();
                }
              }}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmPendingPremium();
              }}
              disabled={
                !pendingPremiumAmt ||
                !Number.isFinite(Number(pendingPremiumAmt)) ||
                Number(pendingPremiumAmt) <= 0
              }
            >
              Save premium & continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={pendingUnsold !== null} onOpenChange={(o) => !o && setPendingUnsold(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Erase this sale?</AlertDialogTitle>
            <AlertDialogDescription>
              This {sideLabel} side is currently marked <strong>Sold</strong>. Changing the disposition to{" "}
              <strong className="capitalize">{pendingUnsold?.replace(/_/g, " ")}</strong> will erase the sale,
              clear the policy type, and adjust commissions, leaderboards, and reporting tied to this sale.
              <br />
              <br />
              This cannot be undone automatically — you'll need to re-mark as Sold to restore it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep sale</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmUnsold}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, erase sale
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmReleaseSold} onOpenChange={setConfirmReleaseSold}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release a sold side?</AlertDialogTitle>
            <AlertDialogDescription>
              This {sideLabel} side is marked <strong>Sold</strong>. Releasing it removes your ownership
              and will drop this sale from your commission totals and leaderboards until someone re-claims it.
              <br />
              <br />
              Are you sure you want to release it?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it claimed</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmReleaseSold(false);
                release();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, release sold {sideLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={confirmReleaseScheduled !== null}
        onOpenChange={(o) => !o && setConfirmReleaseScheduled(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Release a scheduled {sideLabel} side?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This {sideLabel} side has a scheduled{" "}
              {confirmReleaseScheduled === "x_date" ? "X-date" : "follow-up"}.
              Releasing it removes your ownership <strong>and</strong> clears
              the scheduled date so it doesn't sit in limbo off everyone's
              calendar.
              <br />
              <br />
              Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it claimed</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmReleaseScheduled(null);
                releaseAndClearSchedule();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Release &amp; clear schedule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={pendingFollowUp !== null}
        onOpenChange={(o) => {
          if (!o) setPendingFollowUp(null);
          // Nested AlertDialog over the Lead Detail Dialog can leave the
          // body in `pointer-events: none`, making inputs uneditable.
          setTimeout(() => {
            if (document.body.style.pointerEvents === "none") {
              document.body.style.pointerEvents = "";
            }
            document.body.removeAttribute("data-scroll-locked");
          }, 0);
        }}
      >
        <AlertDialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Set follow-up date & time</AlertDialogTitle>
            <AlertDialogDescription>
              A follow-up disposition requires a scheduled date and time so this lead lands on your follow-ups queue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1 py-2">
            <Label className="text-xs">Follow-up at</Label>
            {/*
             * Split native date + time inputs. `datetime-local` is
             * unreliable for some users (especially mobile/desktop browser
             * combos) inside Radix AlertDialog — the combined picker can
             * become uneditable. Two simple fields always work.
             */}
            <FollowUpPicker
              value={pendingFollowUpAt}
              onChange={setPendingFollowUpAt}
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmFollowUp();
              }}
              disabled={!pendingFollowUpAt}
            >
              Save follow-up
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={pendingXDate !== null}
        onOpenChange={(o) => {
          if (!o) setPendingXDate(null);
          setTimeout(() => {
            if (document.body.style.pointerEvents === "none") {
              document.body.style.pointerEvents = "";
            }
            document.body.removeAttribute("data-scroll-locked");
          }, 0);
        }}
      >
        <AlertDialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Set X-date</AlertDialogTitle>
            <AlertDialogDescription>
              Mark when the current policy renews so we can reach back out before
              their X-date.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1 py-2">
            <Label className="text-xs">Renewal date</Label>
            <div className="rounded-md border border-border">
              <Calendar
                mode="single"
                selected={ymdToDate(pendingXDateAt)}
                onSelect={(d) => {
                  if (d) setPendingXDateAt(dateToYmd(d));
                }}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {pendingXDateAt
                ? `Selected: ${formatYmdHuman(pendingXDateAt)}`
                : "No date selected yet."}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmXDate();
              }}
              disabled={!pendingXDateAt}
            >
              Save X-date
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={pendingClientLines !== null}
        onOpenChange={(o) => !o && setPendingClientLines(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Which lines do they already have?</AlertDialogTitle>
            <AlertDialogDescription>
              The prospect is already a client. Select every line they currently
              hold so the team knows what's left to cross-sell. At least one is
              required.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-2 gap-2 py-2">
            {EXISTING_CLIENT_LINE_OPTIONS.map((opt) => {
              const checked = clientLines.includes(opt.value);
              return (
                <label
                  key={opt.value}
                  className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm cursor-pointer transition-colors ${
                    checked
                      ? "border-teal-500/50 bg-teal-500/10"
                      : "border-input bg-background hover:bg-accent"
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(c) => {
                      setClientLines((prev) =>
                        c
                          ? Array.from(new Set([...prev, opt.value]))
                          : prev.filter((v) => v !== opt.value),
                      );
                    }}
                  />
                  <span>{opt.label}</span>
                </label>
              );
            })}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmClientLines();
              }}
              disabled={clientLines.length === 0}
            >
              Save lines
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Required Homeowner/Renter selector. Calling code persists the value via the
 * provided `onChange` (typically a Supabase update). Renders inline at the top
 * of any lead detail surface; without a value, dispo selects below are locked.
 */
export function HousingStatusSelector({
  value,
  onChange,
  disabled,
  onFocusSelected,
}: {
  value: HousingStatus;
  onChange: (next: HousingStatus) => void;
  disabled?: boolean;
  onFocusSelected?: (opt: "homeowner" | "renter") => void;
}) {
  const OPTIONS = {
    homeowner: { label: "Homeowner", Icon: Home },
    renter: { label: "Renter", Icon: Key },
  } as const;
  const order: ("homeowner" | "renter")[] =
    value === "renter" ? ["renter", "homeowner"] : ["homeowner", "renter"];
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">
        Housing status <span className="text-destructive">*</span>
      </Label>
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-border/70 bg-muted/30 p-1">
        {(["homeowner", "renter"] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (value === opt) onFocusSelected?.(opt);
              else onChange(opt);
            }}
            className={`rounded-md px-4 py-2 text-sm font-medium capitalize transition-all ${
              value === opt
                ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground"
            } disabled:opacity-50`}
          >
            {opt}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {order.map((opt) => {
          const { label, Icon } = OPTIONS[opt];
          const selected = value === opt;
          return (
            <div
              key={opt}
              className={`group flex w-full items-center gap-4 rounded-xl border p-3.5 transition-all duration-300 ${
                selected
                  ? "border-cyan-400/70 bg-cyan-500/15 shadow-[0_0_20px_rgba(6,182,212,0.25)] shadow-cyan-500/20"
                  : "border-border/40 bg-muted/10 opacity-60 hover:opacity-80 hover:border-border/60"
              }`}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (selected) onFocusSelected?.(opt);
                  else onChange(opt);
                }}
                className="flex flex-1 items-center gap-4 text-left disabled:opacity-50"
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition ${
                    selected
                      ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.35)]"
                      : "border-border/50 bg-muted/30 text-muted-foreground/60"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-semibold transition ${selected ? "text-cyan-100" : "text-muted-foreground/70"}`}>{label}</div>
                </div>
              </button>
              <div onClick={(e) => e.stopPropagation()}>
                <Switch
                  checked={selected}
                  disabled={disabled}
                  onCheckedChange={(c) => onChange(c ? opt : null)}
                  aria-label={`${selected ? "Remove" : "Add"} ${label}`}
                  className={
                    selected
                      ? "data-[state=checked]:bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.4)]"
                      : ""
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
      {!value && (
        <p className="text-xs text-muted-foreground">
          Recommended for accurate scoring and routing.
        </p>
      )}
    </div>
  );
}

/**
 * Renders the Home side pane. Only renders when housing_status is set;
 * for renters the pane is labelled "Renters".
 */
export function LeadSideDispoPanel({
  leadId,
  source,
  housingStatus,
  onHousingChange,
  onFocusSelected,
  home,
  showHome = true,
  scriptType,
  invalidateKeys,
  hidePane = false,
}: {
  leadId: string;
  source: LeadSource;
  housingStatus: HousingStatus;
  onHousingChange: (next: HousingStatus) => void;
  onFocusSelected?: (opt: "homeowner" | "renter") => void;
  home: SideState;
  showHome?: boolean;
  scriptType?: ScriptType;
  invalidateKeys?: readonly unknown[][];
  hidePane?: boolean;
}) {
  const paneRef = useRef<HTMLDivElement | null>(null);
  const prevHousing = useRef<HousingStatus>(housingStatus);
  const [flash, setFlash] = useState(false);
  const shouldShowHome = showHome || !!housingStatus;
  const focusPane = () => {
    requestAnimationFrame(() => {
      paneRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    setFlash(true);
    window.setTimeout(() => setFlash(false), 900);
  };
  useEffect(() => {
    if (!hidePane && housingStatus && housingStatus !== prevHousing.current) {
      focusPane();
    }
    prevHousing.current = housingStatus;
  }, [housingStatus, hidePane]);

  const handleFocusSelected = (opt: "homeowner" | "renter") => {
    if (!hidePane) {
      focusPane();
    }
    onFocusSelected?.(opt);
  };

  return (
    <div className="space-y-3">
      <HousingStatusSelector
        value={housingStatus}
        onChange={onHousingChange}
        onFocusSelected={handleFocusSelected}
      />
      {!hidePane && (
        <div className="grid gap-3 grid-cols-1">
          {shouldShowHome && housingStatus && (
          <div
            ref={paneRef}
            className={`scroll-mt-4 rounded-xl transition-shadow duration-500 ${
              flash ? "ring-2 ring-cyan-400 shadow-[0_0_24px_rgba(34,211,238,0.55)]" : ""
            }`}
          >
            <LeadSidePane
              leadId={leadId}
              source={source}
              side="home"
              housingStatus={housingStatus}
              state={home}
              scriptType={scriptType}
              invalidateKeys={invalidateKeys}
            />
          </div>
          )}
        </div>
      )}
    </div>
  );
}