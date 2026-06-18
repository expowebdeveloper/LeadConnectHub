import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useHasRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  LINE_TYPE_META,
  LINE_TYPES,
  type LeadLine,
  type LineType,
} from "@/lib/constants";
import { useDispoOptions } from "@/hooks/useDispoOptions";
import { Plus, Umbrella, Waves, Bike, Anchor, Caravan, Flag, ArrowRight, ShieldCheck, Car, Home as HomeIcon } from "lucide-react";
import { toast } from "sonner";
import { DISPO_OPTIONS, type Dispo } from "@/lib/constants";
import { LineSharePopover } from "@/components/LineSharePopover";
import { LeadNotesThread } from "@/components/LeadNotesThread";



type Source = "leads" | "list_leads";

export type PrimaryAddress = {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

export type AddressValue = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

export function normalizeAddressValue(v: unknown): AddressValue {
  if (typeof v === "string") return { street: v, city: "", state: "", zip: "" };
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return {
      street: typeof o.street === "string" ? o.street : "",
      city: typeof o.city === "string" ? o.city : "",
      state: typeof o.state === "string" ? o.state : "",
      zip: typeof o.zip === "string" ? o.zip : "",
    };
  }
  return { street: "", city: "", state: "", zip: "" };
}

function uuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Cross-component scroll signal: when the right-column picker adds a line,
// the left-column sections panel scrolls to it.
const LINE_ADDED_EVENT = "lead-line-added";
function emitLineAdded(leadId: string, lineId: string) {
  if (typeof document === "undefined") return;
  document.dispatchEvent(
    new CustomEvent(LINE_ADDED_EVENT, { detail: { leadId, lineId } }),
  );
}

export function useLeadLines(leadId: string, source: Source, invalidateKeys: readonly unknown[][] = []) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const key = ["lead-extra-lines", source, leadId] as const;
  const q = useQuery({
    queryKey: key,
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await (supabase.from(source) as any)
        .select("lead_lines")
        .eq("id", leadId)
        .maybeSingle();
      if (error) throw error;
      return (data?.lead_lines ?? []) as LeadLine[];
    },
  });

  const lines: LeadLine[] = useMemo(() => q.data ?? [], [q.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    for (const k of invalidateKeys) qc.invalidateQueries({ queryKey: k });
  };

  const upsertMut = useMutation({
    mutationFn: async (line: LeadLine) => {
      const { data, error } = await (supabase.rpc as any)("lead_line_upsert", {
        p_table: source,
        p_lead_id: leadId,
        p_line: line,
      });
      if (error) throw error;
      return (data ?? []) as LeadLine[];
    },
    onMutate: async (line: LeadLine) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<LeadLine[]>(key) ?? [];
      const idx = prev.findIndex((l) => l.line_id === line.line_id);
      const next = idx >= 0
        ? prev.map((l) => (l.line_id === line.line_id ? line : l))
        : [...prev, line];
      qc.setQueryData<LeadLine[]>(key, next);
      return { prev };
    },
    onSuccess: (server) => {
      qc.setQueryData<LeadLine[]>(key, server);
      invalidate();
    },
    onError: (e, _line, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(e instanceof Error ? e.message : "Failed to save coverage");
    },
  });

  const removeMut = useMutation({
    mutationFn: async (line_id: string) => {
      const { data, error } = await (supabase.rpc as any)("lead_line_remove", {
        p_table: source,
        p_lead_id: leadId,
        p_line_id: line_id,
      });
      if (error) throw error;
      return (data ?? []) as LeadLine[];
    },
    onMutate: async (line_id: string) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<LeadLine[]>(key) ?? [];
      qc.setQueryData<LeadLine[]>(key, prev.filter((l) => l.line_id !== line_id));
      return { prev };
    },
    onSuccess: (server) => {
      qc.setQueryData<LeadLine[]>(key, server);
      invalidate();
    },
    onError: (e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(e instanceof Error ? e.message : "Failed to remove coverage");
    },
  });

  const addLine = (t: LineType) => {
    const line: LeadLine = {
      line_id: uuid(),
      type: t,
      details: {},
      dispo: null,
      quoted_premium: null,
      claimed_by: userId,
      sold_at: null,
      agent_notes: null,
    };
    upsertMut.mutate(line, {
      onSuccess: () => {
        emitLineAdded(leadId, line.line_id);
        qc.invalidateQueries({ queryKey: ["lead_activities", source, leadId] });
      },
    });
  };

  const updateLine = (line_id: string, patch: Partial<LeadLine>) => {
    const existing = lines.find((l) => l.line_id === line_id);
    if (!existing) return;
    upsertMut.mutate({ ...existing, ...patch, line_id });
  };

  const removeLine = (line_id: string) => {
    removeMut.mutate(line_id, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["lead_activities", source, leadId] });
      },
    });
  };

  return { lines, isLoading: q.isLoading, userId, addLine, updateLine, removeLine, isPending: upsertMut.isPending || removeMut.isPending };
}

/**
 * Right-column cross-sell picker. Always visible so agents can keep adding
 * lines; each Add dispatches a global event the left-column sections panel
 * listens for, so the new section auto-scrolls into view.
 */
export function LeadExtraLinesPicker({
  leadId,
  source,
  invalidateKeys = [],
}: {
  leadId: string;
  source: Source;
  invalidateKeys?: readonly unknown[][];
}) {
  const { addLine, lines } = useLeadLines(leadId, source, invalidateKeys);
  const counts = new Map<LineType, number>();
  for (const l of lines) counts.set(l.type, (counts.get(l.type) ?? 0) + 1);
  const onAdd = (t: LineType) => addLine(t);
  const onFocus = (t: LineType) => {
    // Focus the most recently added line of this type.
    const target = [...lines].reverse().find((l) => l.type === t);
    if (target) emitLineAdded(leadId, target.line_id);
  };
  return (
    <CrossSellSpotlight onAdd={onAdd} onFocus={onFocus} counts={counts} />
  );
}

/**
 * Left-column panel that renders each added line as a full section styled
 * to match the Auto block (cyan accent bar, large heading, dispo chips,
 * premium card, notes). Nothing renders until a line is added.
 */
export function LeadExtraLinesSections({
  leadId,
  source,
  invalidateKeys = [],
  primaryAddress,
}: {
  leadId: string;
  source: Source;
  invalidateKeys?: readonly unknown[][];
  primaryAddress?: PrimaryAddress | null;
}) {
  const { lines, userId, updateLine, removeLine } = useLeadLines(leadId, source, invalidateKeys);
  const isAdmin = useHasRole("admin");
  const { options: dispoOptions } = useDispoOptions();
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ leadId: string; lineId: string }>;
      if (ev.detail?.leadId !== leadId) return;
      const id = ev.detail.lineId;
      // Wait a frame for the new section to mount.
      requestAnimationFrame(() => {
        sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };
    document.addEventListener(LINE_ADDED_EVENT, handler);
    return () => document.removeEventListener(LINE_ADDED_EVENT, handler);
  }, [leadId]);

  if (lines.length === 0) return null;
  return (
    <div className="space-y-8">
      {lines.map((line) => (
        <div
          key={line.line_id}
          ref={(el) => {
            sectionRefs.current[line.line_id] = el;
          }}
          className="scroll-mt-4"
        >
          <LineSection
            line={line}
            userId={userId}
            isAdmin={isAdmin}
            dispoOptions={dispoOptions}
            onUpdate={(patch) => updateLine(line.line_id, patch)}
            onRemove={() => removeLine(line.line_id)}
            leadId={leadId}
            leadTable={source}
            primaryAddress={primaryAddress ?? null}
          />
        </div>
      ))}
    </div>
  );
}

export function LeadExtraLines({
  leadId,
  source,
  invalidateKeys = [],
}: {
  leadId: string;
  source: Source;
  invalidateKeys?: readonly unknown[][];
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const isAdmin = useHasRole("admin");
  const { options: dispoOptions } = useDispoOptions();

  const key = ["lead-extra-lines", source, leadId] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await (supabase.from(source) as any)
        .select("lead_lines")
        .eq("id", leadId)
        .maybeSingle();
      if (error) throw error;
      return (data?.lead_lines ?? []) as LeadLine[];
    },
  });

  const lines: LeadLine[] = useMemo(() => q.data ?? [], [q.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    for (const k of invalidateKeys) qc.invalidateQueries({ queryKey: k });
  };

  const upsertMut = useMutation({
    mutationFn: async (line: LeadLine) => {
      const { data, error } = await (supabase.rpc as any)("lead_line_upsert", {
        p_table: source,
        p_lead_id: leadId,
        p_line: line,
      });
      if (error) throw error;
      return (data ?? []) as LeadLine[];
    },
    onMutate: async (line: LeadLine) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<LeadLine[]>(key) ?? [];
      const idx = prev.findIndex((l) => l.line_id === line.line_id);
      const next = idx >= 0
        ? prev.map((l) => (l.line_id === line.line_id ? line : l))
        : [...prev, line];
      qc.setQueryData<LeadLine[]>(key, next);
      return { prev };
    },
    onSuccess: (server) => {
      qc.setQueryData<LeadLine[]>(key, server);
      invalidate();
    },
    onError: (e, _line, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(e instanceof Error ? e.message : "Failed to save coverage");
    },
  });

  const removeMut = useMutation({
    mutationFn: async (line_id: string) => {
      const { data, error } = await (supabase.rpc as any)("lead_line_remove", {
        p_table: source,
        p_lead_id: leadId,
        p_line_id: line_id,
      });
      if (error) throw error;
      return (data ?? []) as LeadLine[];
    },
    onMutate: async (line_id: string) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<LeadLine[]>(key) ?? [];
      qc.setQueryData<LeadLine[]>(key, prev.filter((l) => l.line_id !== line_id));
      return { prev };
    },
    onSuccess: (server) => {
      qc.setQueryData<LeadLine[]>(key, server);
      invalidate();
    },
    onError: (e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(e instanceof Error ? e.message : "Failed to remove coverage");
    },
  });

  const [addOpen, setAddOpen] = useState(false);
  const [newType, setNewType] = useState<LineType>("motorcycle");
  const [newDetails, setNewDetails] = useState<Record<string, unknown>>({});
  const [focusLineId, setFocusLineId] = useState<string | null>(null);
  const lineRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!focusLineId) return;
    const el = lineRefs.current[focusLineId];
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      setFocusLineId(null);
    }
  }, [focusLineId, lines]);

  const openAddWith = (t: LineType) => {
    const line: LeadLine = {
      line_id: uuid(),
      type: t,
      details: {},
      dispo: null,
      quoted_premium: null,
      claimed_by: userId,
      sold_at: null,
      agent_notes: null,
    };
    upsertMut.mutate(line, {
      onSuccess: () => {
        setFocusLineId(line.line_id);
      },
    });
  };

  const addLine = () => {
    const line: LeadLine = {
      line_id: uuid(),
      type: newType,
      details: newDetails,
      dispo: null,
      quoted_premium: null,
      claimed_by: userId,
      sold_at: null,
      agent_notes: null,
    };
    upsertMut.mutate(line, {
      onSuccess: () => {
        setAddOpen(false);
        setNewType("motorcycle");
        setNewDetails({});
      },
    });
  };

  const updateLine = (line_id: string, patch: Partial<LeadLine>) => {
    const existing = lines.find((l) => l.line_id === line_id);
    if (!existing) return;
    upsertMut.mutate({ ...existing, ...patch, line_id });
  };

  const removeLine = (line_id: string) => {
    removeMut.mutate(line_id);
  };

  return (
    <div className="space-y-4">

      {q.isLoading ? (
        <div className="text-xs text-muted-foreground">Loading coverages…</div>
      ) : lines.length === 0 ? (
        <CrossSellSpotlight onAdd={(t) => openAddWith(t)} />
      ) : (
        <div className="grid gap-3">
          {lines.map((line) => (
            <div
              key={line.line_id}
              ref={(el) => {
                lineRefs.current[line.line_id] = el;
              }}
              className="scroll-mt-4"
            >
              <LineCard
                line={line}
                userId={userId}
                isAdmin={isAdmin}
                dispoOptions={dispoOptions}
                onUpdate={(patch) => updateLine(line.line_id, patch)}
                onRemove={() => removeLine(line.line_id)}
                leadId={leadId}
                leadTable={source}
              />
            </div>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add a line</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Type</Label>
              <Select
                value={newType}
                onValueChange={(v) => {
                  setNewType(v as LineType);
                  setNewDetails({});
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LINE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {LINE_TYPE_META[t].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DetailFields
              type={newType}
              values={newDetails}
              onChange={setNewDetails}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addLine} disabled={upsertMut.isPending}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailFields({
  type,
  values,
  onChange,
  primaryAddress,
}: {
  type: LineType;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  primaryAddress?: PrimaryAddress | null;
}) {
  const fields = LINE_TYPE_META[type].fields;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {fields.map((f) => {
        const v = values[f.key];
        if (f.type === "checkbox") {
          return (
            <label
              key={f.key}
              className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm sm:col-span-2"
            >
              <Checkbox
                checked={Boolean(v)}
                onCheckedChange={(c) => onChange({ ...values, [f.key]: !!c })}
              />
              <span>{f.label}</span>
            </label>
          );
        }
        if (f.type === "address") {
          const addr = normalizeAddressValue(v);
          const primary: AddressValue = {
            street: primaryAddress?.street ?? "",
            city: primaryAddress?.city ?? "",
            state: primaryAddress?.state ?? "",
            zip: primaryAddress?.zip ?? "",
          };
          const hasPrimary =
            !!(primary.street || primary.city || primary.state || primary.zip);
          const matchesPrimary =
            addr.street === primary.street &&
            addr.city === primary.city &&
            addr.state === primary.state &&
            addr.zip === primary.zip;
          const isEmpty = !addr.street && !addr.city && !addr.state && !addr.zip;
          const setAddr = (next: AddressValue) =>
            onChange({ ...values, [f.key]: next });
          return (
            <div key={f.key} className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">{f.label}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  disabled={!hasPrimary || matchesPrimary}
                  onClick={() => setAddr(primary)}
                >
                  {matchesPrimary ? "Same as primary" : "Copy primary address"}
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-6">
                <Input
                  className="sm:col-span-6"
                  placeholder="Street"
                  value={addr.street}
                  onChange={(e) => setAddr({ ...addr, street: e.target.value })}
                />
                <Input
                  className="sm:col-span-3"
                  placeholder="City"
                  value={addr.city}
                  onChange={(e) => setAddr({ ...addr, city: e.target.value })}
                />
                <Input
                  className="sm:col-span-1"
                  placeholder="ST"
                  maxLength={2}
                  value={addr.state}
                  onChange={(e) =>
                    setAddr({ ...addr, state: e.target.value.toUpperCase() })
                  }
                />
                <Input
                  className="sm:col-span-2"
                  placeholder="ZIP"
                  inputMode="numeric"
                  value={addr.zip}
                  onChange={(e) => setAddr({ ...addr, zip: e.target.value })}
                />
              </div>
              {isEmpty && (
                <p className="text-[11px] text-muted-foreground">
                  Likely a different (secondary) address — leave blank or copy primary.
                </p>
              )}
            </div>
          );
        }
        return (
          <div key={f.key} className="space-y-1">
            <Label className="text-xs">{f.label}</Label>
            <Input
              type={f.type === "number" ? "number" : "text"}
              placeholder={f.placeholder}
              value={v == null ? "" : String(v)}
              onChange={(e) => {
                const raw = e.target.value;
                onChange({
                  ...values,
                  [f.key]:
                    f.type === "number"
                      ? raw === ""
                        ? null
                        : Number(raw)
                      : raw,
                });
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function LineCard({
  line,
  userId,
  isAdmin,
  dispoOptions,
  onUpdate,
  onRemove,
  leadId,
  leadTable,
}: {
  line: LeadLine;
  userId: string | null;
  isAdmin: boolean;
  dispoOptions: { value: string; label: string }[];
  onUpdate: (patch: Partial<LeadLine>) => void;
  onRemove: () => void;
  leadId: string;
  leadTable: Source;
}) {
  const meta = LINE_TYPE_META[line.type];
  const claimedByMe = !!line.claimed_by && line.claimed_by === userId;
  const claimedByOther = !!line.claimed_by && !claimedByMe && !isAdmin;

  const [premium, setPremium] = useState(
    line.quoted_premium != null ? String(line.quoted_premium) : "",
  );
  const [notes, setNotes] = useState(line.agent_notes ?? "");
  const [details, setDetails] = useState<Record<string, unknown>>(
    (line.details as Record<string, unknown>) ?? {},
  );
  const [pendingUnsold, setPendingUnsold] = useState<string | null>(null);

  const onDispoChange = (v: string) => {
    // Use local input state so an unblurred premium still counts.
    const localPremium =
      premium.trim() === "" ? null : Number(premium);
    const effectivePremium =
      localPremium != null && Number.isFinite(localPremium)
        ? localPremium
        : line.quoted_premium;
    if (v === "sold") {
      const hasPremium =
        typeof effectivePremium === "number" &&
        Number.isFinite(effectivePremium) &&
        effectivePremium > 0;
      if (!hasPremium) {
        toast.error("Enter a quoted premium before marking this coverage as sold.");
        return;
      }
    }
    if (line.dispo === "sold" && v !== "sold") {
      setPendingUnsold(v);
      return;
    }
    const patch: Partial<LeadLine> = { dispo: v };
    if (v !== "sold") patch.sold_at = null;
    if (!line.claimed_by && userId) patch.claimed_by = userId;
    if (
      effectivePremium != null &&
      Number.isFinite(effectivePremium) &&
      effectivePremium !== line.quoted_premium
    ) {
      patch.quoted_premium = effectivePremium;
    }
    onUpdate(patch);
  };

  const savePremium = () => {
    const n = premium.trim() === "" ? null : Number(premium);
    if (n != null && !Number.isFinite(n)) return;
    onUpdate({ quoted_premium: n });
  };
  const saveNotes = () => onUpdate({ agent_notes: notes });
  const saveDetails = () => onUpdate({ details });

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{meta.label}</span>
          {line.dispo && (
            <Badge variant="secondary" className="capitalize">
              {line.dispo.replace(/_/g, " ")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          <LineSharePopover
            leadId={leadId}
            leadTable={leadTable}
            lineId={line.line_id}
            lineClaimedBy={line.claimed_by ?? null}
            uid={userId}
          />
          <Switch
            id={`claim-${line.line_id}`}
            checked={!!line.claimed_by}
            disabled={claimedByOther}
            onCheckedChange={(checked) => {
              if (checked && userId) onUpdate({ claimed_by: userId });
              else onUpdate({ claimed_by: null });
            }}
            aria-label={claimedByOther ? "Claimed" : "Claim"}
            className={!!line.claimed_by ? "data-[state=checked]:bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.4)]" : ""}
          />
        </div>
      </div>

      <fieldset
        disabled={claimedByOther}
        className="space-y-3 disabled:opacity-60"
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Dispo</Label>
            <Select
              value={line.dispo ?? ""}
              onValueChange={(v) => onDispoChange(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick a dispo" />
              </SelectTrigger>
              <SelectContent>
                {dispoOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Quoted premium ($)</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                value={premium}
                onChange={(e) => setPremium(e.target.value)}
                onBlur={savePremium}
              />
            </div>
          </div>
        </div>

        <details className="rounded-md border bg-muted/10">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
            Details
          </summary>
          <div className="space-y-3 p-3">
            <DetailFields
              type={line.type}
              values={details}
              onChange={setDetails}
            />
          </div>
        </details>

        <LeadNotesThread
          leadId={leadId}
          leadTable={leadTable}
          lineKey={line.line_id}
          title="Notes"
        />
      </fieldset>

      <AlertDialog
        open={pendingUnsold !== null}
        onOpenChange={(o) => !o && setPendingUnsold(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo this sale?</AlertDialogTitle>
            <AlertDialogDescription>
              Changing this {meta.label} line away from “Sold” will remove the
              sale from leaderboards and commissions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const v = pendingUnsold!;
                setPendingUnsold(null);
                onUpdate({ dispo: v, sold_at: null });
              }}
            >
              Undo sale
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

export const CROSS_SELL_LINES: {
  type: LineType;
  label: string;
  Icon: typeof Umbrella;
}[] = [
  { type: "umbrella", label: "Umbrella", Icon: Umbrella },
  { type: "flood", label: "Flood", Icon: Waves },
  { type: "boat", label: "Boat", Icon: Anchor },
  { type: "motorcycle", label: "Motorcycle", Icon: Bike },
  { type: "rv", label: "RV", Icon: Caravan },
  { type: "golf_cart", label: "Golf Cart", Icon: Flag },
];

export function CrossSellSpotlight({
  onAdd,
  onFocus,
  counts,
}: {
  onAdd: (t: LineType) => void;
  onFocus?: (t: LineType) => void;
  counts?: Map<LineType, number>;
}) {
  return (
    <div className="space-y-2">
      {CROSS_SELL_LINES.map(({ type, label, Icon }) => {
        const count = counts?.get(type) ?? 0;
        const active = count > 0;
        return (
          <div
            key={type}
            className={`group flex w-full items-center gap-4 rounded-xl border p-3.5 text-left transition-all duration-300 ${
              active
                ? "border-cyan-400/70 bg-cyan-500/15 shadow-[0_0_20px_rgba(6,182,212,0.25)] shadow-cyan-500/20"
                : "border-border/40 bg-muted/10 opacity-60 hover:opacity-80 hover:border-border/60"
            }`}
          >
            <button
              type="button"
              onClick={() => active && onFocus?.(type)}
              disabled={!active}
              aria-label={active ? `Jump to ${label} section` : label}
              className={`flex flex-1 items-center gap-4 text-left transition ${
                active ? "cursor-pointer" : "cursor-default"
              }`}
            >
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition ${
                  active
                    ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.35)] group-hover:bg-cyan-500/30"
                    : "border-border/50 bg-muted/30 text-muted-foreground/60"
                }`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 flex items-center gap-2">
                <div
                  className={`text-sm font-semibold transition ${
                    active ? "text-cyan-100" : "text-muted-foreground/70"
                  }`}
                >
                  {label}
                </div>
                {count > 0 && (
                  <Badge
                    variant="outline"
                    className="border-cyan-400/60 bg-cyan-500/15 text-cyan-200 text-[10px] px-1.5 py-0"
                  >
                    ×{count}
                  </Badge>
                )}
              </div>
            </button>
            <div onClick={(e) => e.stopPropagation()}>
              <Button
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                onClick={() => onAdd(type)}
                aria-label={active ? `Add another ${label}` : `Add ${label}`}
                className={
                  active
                    ? "h-8 gap-1 bg-cyan-500 hover:bg-cyan-400 text-white shadow-[0_0_10px_rgba(34,211,238,0.4)]"
                    : "h-8 gap-1"
                }
              >
                <Plus className="h-3.5 w-3.5" />
                {active ? "Add another" : "Add"}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const LINE_ICONS: Record<LineType, typeof Umbrella> = {
  umbrella: Umbrella,
  flood: Waves,
  boat: Anchor,
  motorcycle: Bike,
  rv: Caravan,
  golf_cart: Flag,
  auto: Car,
  home: HomeIcon,
};

/**
 * Full-width section for an added line, styled to match the Auto block on
 * the left column: cyan accent bar + large heading, dispo chip row, quoted
 * premium card, and agent notes.
 */
export function LineSection({
  line,
  userId,
  isAdmin,
  dispoOptions,
  onUpdate,
  onRemove,
  leadId,
  leadTable,
  primaryAddress,
}: {
  line: LeadLine;
  userId: string | null;
  isAdmin: boolean;
  dispoOptions: { value: string; label: string }[];
  onUpdate: (patch: Partial<LeadLine>) => void;
  onRemove: () => void;
  leadId: string;
  leadTable: Source;
  primaryAddress?: PrimaryAddress | null;
}) {
  const meta = LINE_TYPE_META[line.type];
  const Icon = LINE_ICONS[line.type] ?? Umbrella;
  const claimedByMe = !!line.claimed_by && line.claimed_by === userId;
  const claimedByOther = !!line.claimed_by && !claimedByMe && !isAdmin;

  const [premium, setPremium] = useState(
    line.quoted_premium != null ? String(line.quoted_premium) : "",
  );
  const [notes, setNotes] = useState(line.agent_notes ?? "");
  const [details, setDetails] = useState<Record<string, unknown>>(
    (line.details as Record<string, unknown>) ?? {},
  );
  const [pendingUnsold, setPendingUnsold] = useState<string | null>(null);

  // Per-dispo color tones — same palette the Auto section uses so the two
  // blocks read as one consistent design.
  const TONE: Record<string, string> = {
    quoted: "border-sky-500/60 bg-sky-500/15 text-sky-300",
    sold: "border-emerald-500/60 bg-emerald-500/15 text-emerald-300",
    not_quoted: "border-rose-500/60 bg-rose-500/15 text-rose-300",
    voicemail: "border-slate-500/60 bg-slate-500/15 text-slate-300",
    follow_up: "border-amber-500/60 bg-amber-500/15 text-amber-300",
    x_date: "border-violet-500/60 bg-violet-500/15 text-violet-300",
    already_has_allstate: "border-cyan-500/60 bg-cyan-500/15 text-cyan-300",
    already_a_client: "border-teal-500/60 bg-teal-500/15 text-teal-300",
    wrong_number: "border-orange-500/60 bg-orange-500/15 text-orange-300",
    dead: "border-zinc-500/60 bg-zinc-500/15 text-zinc-300",
    dnc: "border-red-600/60 bg-red-600/15 text-red-300",
  };

  const onDispoChange = (v: string) => {
    const localPremium = premium.trim() === "" ? null : Number(premium);
    const effectivePremium =
      localPremium != null && Number.isFinite(localPremium)
        ? localPremium
        : line.quoted_premium;
    if (v === "sold") {
      const hasPremium =
        typeof effectivePremium === "number" &&
        Number.isFinite(effectivePremium) &&
        effectivePremium > 0;
      if (!hasPremium) {
        toast.error("Enter a quoted premium before marking this coverage as sold.");
        return;
      }
    }
    if (line.dispo === "sold" && v !== "sold") {
      setPendingUnsold(v);
      return;
    }
    const patch: Partial<LeadLine> = { dispo: v };
    if (v !== "sold") patch.sold_at = null;
    if (!line.claimed_by && userId) patch.claimed_by = userId;
    if (
      effectivePremium != null &&
      Number.isFinite(effectivePremium) &&
      effectivePremium !== line.quoted_premium
    ) {
      patch.quoted_premium = effectivePremium;
    }
    onUpdate(patch);
  };

  const toggleDispo = (v: string) => {
    if (line.dispo === v) {
      // unsetting an existing dispo
      if (v === "sold") {
        setPendingUnsold("");
        return;
      }
      onUpdate({ dispo: null });
      return;
    }
    onDispoChange(v);
  };

  const savePremium = () => {
    const n = premium.trim() === "" ? null : Number(premium);
    if (n != null && !Number.isFinite(n)) return;
    onUpdate({ quoted_premium: n });
  };
  const saveNotes = () => onUpdate({ agent_notes: notes });
  const saveDetails = () => onUpdate({ details });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-5xl font-bold tracking-tight text-foreground">{meta.label}</h2>
          <Icon className="ml-1 h-6 w-6 text-cyan-400/70" />
        </div>
        <div className="flex items-center gap-3">
          <LineSharePopover
            leadId={leadId}
            leadTable={leadTable}
            lineId={line.line_id}
            lineClaimedBy={line.claimed_by ?? null}
            uid={userId}
          />
          <Switch
            id={`claim-${line.line_id}`}
            checked={!!line.claimed_by}
            disabled={claimedByOther}
            onCheckedChange={(checked) => {
              if (checked && userId) onUpdate({ claimed_by: userId });
              else onUpdate({ claimed_by: null });
            }}
            aria-label={claimedByOther ? "Claimed" : "Claim"}
            className={!!line.claimed_by ? "data-[state=checked]:bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.4)]" : ""}
          />
        </div>
      </div>

      <fieldset disabled={claimedByOther} className="space-y-6 disabled:opacity-60">
        {meta.fields.length > 0 && (
          <section className="space-y-3">
            <SectionLabel>Details</SectionLabel>
            <div className="rounded-2xl border border-border/60 bg-background/40 backdrop-blur-md p-4">
              <DetailFields
                type={line.type}
                values={details}
                onChange={(next) => {
                  setDetails(next);
                  onUpdate({ details: next });
                }}
                primaryAddress={primaryAddress ?? null}
              />
            </div>
          </section>
        )}

        <section>
          <div className="relative flex items-center gap-4 rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-card/40 to-cyan-500/[0.04] px-4 py-3 backdrop-blur-md">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10">
              <Icon className="h-5 w-5 text-cyan-400" />
            </div>
            <div className="flex-1 text-center">
              <div className="text-[11px] font-medium uppercase tracking-wider text-cyan-400">Quoted Premium</div>
              <div className="mt-0.5 flex items-baseline justify-center gap-0.5 text-2xl font-bold text-cyan-400">
                <span className="text-cyan-400/70">$</span>
                <Input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={premium}
                  onChange={(e) => setPremium(e.target.value)}
                  onBlur={savePremium}
                  placeholder="0.00"
                  className="h-auto w-28 border-0 bg-transparent p-0 text-center font-bold text-2xl tabular-nums tracking-tight text-cyan-400 shadow-none placeholder:text-cyan-400/30 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
            </div>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-cyan-500/20 bg-cyan-500/10">
              <ShieldCheck className="h-5 w-5 text-cyan-400" />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <SectionLabel accent="amber">Disposition</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {DISPO_OPTIONS.map((d) => {
              const active = line.dispo === d.value;
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDispo(d.value)}
                  className={`group relative h-8 rounded-full border px-3 text-xs font-medium tracking-wide transition-all ${
                    active
                      ? "border-cyan-500/70 bg-transparent text-cyan-400"
                      : "border-border/60 bg-transparent text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          {/* Fall back select for any custom dispoOptions not in DISPO_OPTIONS */}
          {dispoOptions.some((o) => !DISPO_OPTIONS.find((d) => d.value === o.value)) && (
            <div className="pt-1">
              <Label className="text-xs text-muted-foreground">Other</Label>
              <Select value={line.dispo ?? ""} onValueChange={(v) => onDispoChange(v)}>
                <SelectTrigger><SelectValue placeholder="Pick a dispo" /></SelectTrigger>
                <SelectContent>
                  {dispoOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </section>

        <section className="space-y-2">
          <SectionLabel accent="cyan">Notes</SectionLabel>
          <LeadNotesThread
            leadId={leadId}
            leadTable={leadTable}
            lineKey={line.line_id}
            title="Notes"
          />
        </section>
      </fieldset>

      <AlertDialog
        open={pendingUnsold !== null}
        onOpenChange={(o) => !o && setPendingUnsold(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo this sale?</AlertDialogTitle>
            <AlertDialogDescription>
              Changing this {meta.label} line away from “Sold” will remove the
              sale from leaderboards and commissions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const v = pendingUnsold!;
                setPendingUnsold(null);
                if (v === "") onUpdate({ dispo: null, sold_at: null });
                else onUpdate({ dispo: v, sold_at: null });
              }}
            >
              Undo sale
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

function SectionLabel({
  children,
  accent = "cyan",
}: {
  children: React.ReactNode;
  accent?: "cyan" | "rose" | "emerald" | "amber";
}) {
  const color = {
    cyan: "text-cyan-500/70",
    rose: "text-rose-500/70",
    emerald: "text-emerald-500/70",
    amber: "text-amber-500/70",
  }[accent];
  return (
    <h3 className={`text-[10px] font-bold uppercase tracking-[0.2em] ${color}`}>
      {children}
    </h3>
  );
}