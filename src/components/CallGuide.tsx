import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, ArrowLeft, RotateCcw, CheckCircle2, AlertTriangle, Ban, Clock, PhoneOff, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  CALL_RESULTS,
  CALL_SCRIPTS,
  LEAD_KINDS,
  type CallResult,
  type LeadKind,
  type ResponseOption,
  type ScriptNode,
  resultStartNode,
} from "@/lib/callScripts";

type Crumb = { nodeId: string; chose?: string };

type LeadSnapshot = {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  date_of_birth?: string | null;
  current_carrier?: string | null;
  current_premium?: number | null;
  quoted_premium?: number | null;
  num_vehicles?: number | null;
  vehicles?: unknown;
  x_date?: string | null;
  dispo?: string | null;
  agent_notes?: string | null;
  vendor_notes?: string | null;
} | null;

function fullName(lead: LeadSnapshot): string {
  if (!lead) return "";
  return [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
}

function fullAddress(lead: LeadSnapshot): string {
  if (!lead) return "";
  const line1 = lead.street?.trim();
  const line2 = [lead.city, lead.state, lead.zip].filter(Boolean).join(", ").replace(", ,", ",").trim();
  return [line1, line2].filter(Boolean).join(", ");
}

function vehiclesSummary(lead: LeadSnapshot): string {
  if (!lead) return "";
  const v = lead.vehicles;
  if (Array.isArray(v) && v.length > 0) {
    return v
      .map((veh) => {
        if (!veh || typeof veh !== "object") return String(veh);
        const o = veh as Record<string, unknown>;
        return [o.year, o.make, o.model].filter(Boolean).join(" ");
      })
      .filter(Boolean)
      .join(", ");
  }
  if (typeof lead.num_vehicles === "number" && lead.num_vehicles > 0) {
    return `${lead.num_vehicles} vehicle${lead.num_vehicles === 1 ? "" : "s"}`;
  }
  return "";
}

function personalize(
  text: string | undefined,
  lead: LeadSnapshot,
  agentName: string = "",
  agentPhone: string = "",
): string {
  if (!text) return "";
  const name = lead?.first_name?.trim() || fullName(lead) || "there";
  const addr = fullAddress(lead);
  const carrier = lead?.current_carrier?.trim() || "";
  const veh = vehiclesSummary(lead);
  const premium = lead?.current_premium ? `$${lead.current_premium}` : "";
  const quoted = lead?.quoted_premium ? `$${lead.quoted_premium}` : "";
  const callback = agentPhone?.trim() || "(your number)";

  const tokens: Array<[RegExp, string]> = [
    [/\[Name\]/g, name],
    [/\{first_name\}/g, name],
    [/\[Agent\]/g, agentName || "your agent"],
    [/\[Phone\]/g, callback],
    [/\[Callback\]/g, callback],
    [/\[Carrier\]/g, carrier || "your current carrier"],
    [/\[Address\]/g, addr || "your address on file"],
    [/\[Vehicles\]/g, veh || "your vehicle"],
    [/\[Premium\]/g, premium || "your current premium"],
    [/\[Quote\]/g, quoted || "the quote"],
  ];
  let out = text;
  for (const [re, val] of tokens) out = out.replace(re, val);
  return out;
}

const FLAG_LABEL: Record<NonNullable<ResponseOption["flag"]>, string> = {
  dnc: "DNC requested",
  wrong_number: "Wrong number",
  bad_number: "Bad number",
  callback: "Callback scheduled",
  quote_started: "Quote started",
  quote_ready: "Quote ready",
  bound: "Policy bound",
};

export function CallGuide({
  leadId,
  leadTable,
  uid,
  initialKind,
  initialResult,
  onClose,
}: {
  leadId: string;
  leadTable: "leads" | "list_leads";
  uid: string;
  initialKind: LeadKind;
  initialResult?: CallResult | null;
  onClose?: () => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<LeadKind>(initialKind);
  const [result, setResult] = useState<CallResult | null>(initialResult ?? null);
  const [path, setPath] = useState<Crumb[]>([]);
  const [flags, setFlags] = useState<NonNullable<ResponseOption["flag"]>[]>([]);

  // Pull live lead data so the script can reference real address, carrier,
  // vehicles, premium, etc. — agent can ask "are you still at 123 Main St?".
  const { data: lead } = useQuery<LeadSnapshot>({
    queryKey: ["call_guide_lead", leadTable, leadId],
    queryFn: async () => {
      const cols = [
        "first_name","last_name","phone","email","street","city","state","zip",
        "date_of_birth","current_carrier","current_premium","quoted_premium",
        "num_vehicles","vehicles","x_date","dispo","agent_notes","vendor_notes",
      ].join(",");
      const { data, error } = await supabase
        .from(leadTable as never)
        .select(cols)
        .eq("id", leadId)
        .maybeSingle();
      if (error) return null;
      return (data ?? null) as LeadSnapshot;
    },
    staleTime: 60_000,
  });

  const { data: agent } = useQuery<{ name: string; phone: string }>({
    queryKey: ["call_guide_agent", uid],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles" as never)
        .select("full_name,direct_phone")
        .eq("id", uid)
        .maybeSingle();
      const p = (data ?? {}) as Record<string, string | null>;
      return {
        name: (p.full_name ?? "").trim(),
        phone: (p.direct_phone ?? "").trim(),
      };
    },
    staleTime: 5 * 60_000,
  });
  const agentName = agent?.name ?? "";
  const agentPhone = agent?.phone ?? "";

  // Reset path when kind or result changes.
  useEffect(() => {
    if (!result) {
      setPath([]);
      setFlags([]);
      return;
    }
    const start = resultStartNode(result);
    setPath(start ? [{ nodeId: start }] : []);
    setFlags([]);
  }, [kind, result]);

  const tree = CALL_SCRIPTS[kind];
  const currentNode: ScriptNode | null = useMemo(() => {
    const last = path[path.length - 1];
    if (!last) return null;
    return tree.nodes[last.nodeId] ?? null;
  }, [path, tree]);

  const logActivity = async (action: string, details: Record<string, unknown>) => {
    await supabase.from("lead_activities" as never).insert({
      lead_id: leadId,
      lead_table: leadTable,
      user_id: uid,
      action,
      details: { source: "call_guide", lead_kind: kind, ...details },
    } as never);
    qc.invalidateQueries({ queryKey: ["lead_activities", leadTable, leadId] });
  };

  const pickResult = (r: CallResult) => {
    setResult(r);
    void logActivity("call_guide_result", { result: r });
  };

  const pickResponse = (opt: ResponseOption) => {
    const last = path[path.length - 1];
    const newPath = [
      ...path.slice(0, -1),
      { ...last, chose: opt.label },
      { nodeId: opt.next },
    ];
    setPath(newPath);
    if (opt.flag && !flags.includes(opt.flag)) setFlags((f) => [...f, opt.flag!]);
    void logActivity("call_guide_step", {
      from: last?.nodeId,
      to: opt.next,
      chose: opt.label,
      flag: opt.flag ?? null,
      dispo: opt.dispo ?? null,
    });
  };

  const goBack = () => {
    if (path.length <= 1) {
      setResult(null);
      return;
    }
    setPath((p) => {
      const next = p.slice(0, -1);
      const last = next[next.length - 1];
      if (last) next[next.length - 1] = { nodeId: last.nodeId };
      return next;
    });
  };

  const reset = () => {
    setResult(null);
    setPath([]);
    setFlags([]);
  };

  // Step 1: choose call result.
  if (!result) {
    // Split outcomes: "connected" is the primary live-call action; everything
    // else is a post-attempt disposition (prospect never engaged).
    const endedOutcomes = CALL_RESULTS.filter((r) => r.value !== "connected");
    return (
      <div className="space-y-3">
        <Header
          kind={kind}
          setKind={setKind}
          onClose={onClose}
          flags={flags}
        />
        {/* Live "calling…" state. The script unlocks only when the prospect
            actually picks up — that's the single primary action. */}
        <div className="rounded-md border border-primary/30 bg-primary/5 p-4 text-center">
          <div className="mb-1 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            Calling…
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Ringing the prospect. When they pick up, start the script.
          </p>
          <Button
            size="lg"
            className="w-full"
            onClick={() => pickResult("connected")}
          >
            <Phone className="mr-2 h-4 w-4" /> Prospect answered — start script
          </Button>
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <PhoneOff className="h-3 w-3" /> Or log how the call ended
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {endedOutcomes.map((r) => (
              <Button
                key={r.value}
                variant="outline"
                size="sm"
                className={cn(
                  "h-auto justify-start whitespace-normal py-1.5 text-left text-xs",
                  r.tone === "bad" &&
                    "border-destructive/40 text-destructive hover:bg-destructive/10",
                  r.tone === "warn" &&
                    "border-amber-300 text-amber-700 hover:bg-amber-50 dark:text-amber-400",
                )}
                onClick={() => pickResult(r.value)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Step 2a: voicemail — no node tree.
  if (result === "voicemail") {
    return (
      <div className="space-y-3">
        <Header kind={kind} setKind={setKind} onClose={onClose} flags={flags} />
        <ResultBadge result={result} />
        <LeadSnapshotCard lead={lead ?? null} />
        <div className="rounded-md border bg-emerald-50 p-3 dark:bg-emerald-950/20">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Voicemail script — {tree.label}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
            {personalize(tree.voicemail, lead ?? null, agentName, agentPhone)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              void logActivity("call_guide_voicemail", { kind });
              onClose?.();
            }}
          >
            <CheckCircle2 className="mr-1.5 h-4 w-4" /> Logged voicemail
          </Button>
          <Button variant="outline" onClick={reset}>
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Change result
          </Button>
        </div>
      </div>
    );
  }

  // Step 2b: node-driven flow.
  if (!currentNode) {
    return (
      <div className="space-y-3">
        <Header kind={kind} setKind={setKind} onClose={onClose} flags={flags} />
        <p className="text-sm text-muted-foreground">No script node found.</p>
        <Button variant="outline" onClick={reset}>Reset</Button>
      </div>
    );
  }

  const isTerminal = !currentNode.responses || currentNode.responses.length === 0;

  return (
    <div className="space-y-3">
      <Header kind={kind} setKind={setKind} onClose={onClose} flags={flags} />
      <ResultBadge result={result} />
      <LeadSnapshotCard lead={lead ?? null} />

      {/* Breadcrumb of chosen responses */}
      {path.length > 1 && (
        <div className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
          {path.slice(0, -1).map((c, i) =>
            c.chose ? (
              <span key={i} className="rounded-full bg-muted px-2 py-0.5">
                {c.chose}
              </span>
            ) : null,
          )}
        </div>
      )}

      <div className="rounded-md border bg-card p-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {currentNode.title}
          </p>
          {isTerminal && (
            <Badge variant="secondary" className="text-[10px]">
              End of path
            </Badge>
          )}
        </div>
        {currentNode.hint && (
          <p className="mb-2 flex items-start gap-1.5 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{personalize(currentNode.hint, lead ?? null, agentName, agentPhone)}</span>
          </p>
        )}
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {personalize(currentNode.agent, lead ?? null, agentName, agentPhone)}
        </p>
        <CopyLineButton
          text={personalize(currentNode.agent, lead ?? null, agentName, agentPhone)}
        />
        {currentNode.id === "opener" && lead?.street && (
          <p className="mt-2 rounded bg-primary/5 px-2 py-1 text-xs text-primary">
            Address on file: {fullAddress(lead)}
          </p>
        )}
      </div>

      {currentNode.responses && currentNode.responses.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            What did the prospect say?
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {currentNode.responses.map((opt, i) => (
              <Button
                key={i}
                variant="outline"
                className={cn(
                  "h-auto justify-start whitespace-normal py-2 text-left text-sm",
                  opt.flag === "dnc" && "border-destructive/40 text-destructive hover:bg-destructive/10",
                  opt.flag === "bound" && "border-emerald-400 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400",
                  opt.flag === "quote_ready" && "border-primary/50",
                )}
                onClick={() => pickResponse(opt)}
              >
                <span className="flex-1">{opt.label}</span>
                {opt.flag === "dnc" && <Ban className="ml-2 h-3.5 w-3.5" />}
                {opt.flag === "callback" && <Clock className="ml-2 h-3.5 w-3.5" />}
                {opt.flag === "bound" && <CheckCircle2 className="ml-2 h-3.5 w-3.5" />}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={goBack} disabled={path.length === 0}>
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
        </Button>
        <Button size="sm" variant="ghost" onClick={reset}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restart
        </Button>
        {isTerminal && (
          <Button size="sm" className="ml-auto" onClick={onClose}>
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Done
          </Button>
        )}
      </div>
    </div>
  );
}

function Header({
  kind,
  setKind,
  onClose,
  flags,
}: {
  kind: LeadKind;
  setKind: (k: LeadKind) => void;
  onClose?: () => void;
  flags: NonNullable<ResponseOption["flag"]>[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Phone className="h-4 w-4 text-primary" />
      <span className="text-sm font-semibold">Call Guide</span>
      <Select value={kind} onValueChange={(v) => setKind(v as LeadKind)}>
        <SelectTrigger className="h-7 w-auto min-w-[160px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LEAD_KINDS.map((k) => (
            <SelectItem key={k.value} value={k.value} className="text-xs">
              {k.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {flags.map((f) => (
            <Badge key={f} variant="secondary" className="text-[10px]">
              {FLAG_LABEL[f]}
            </Badge>
          ))}
        </div>
      )}
      {onClose && (
        <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={onClose}>
          Close
        </Button>
      )}
    </div>
  );
}

function ResultBadge({ result }: { result: CallResult }) {
  const r = CALL_RESULTS.find((x) => x.value === result);
  if (!r) return null;
  return (
    <Badge variant="outline" className="text-[11px]">
      Result: {r.label}
    </Badge>
  );
}

function LeadSnapshotCard({ lead }: { lead: LeadSnapshot }) {
  if (!lead) return null;
  const name = fullName(lead);
  const addr = fullAddress(lead);
  const veh = vehiclesSummary(lead);
  const items: Array<[string, string]> = [];
  if (name) items.push(["Name", name]);
  if (addr) items.push(["Address", addr]);
  if (lead.current_carrier) items.push(["Carrier", lead.current_carrier]);
  if (lead.current_premium) items.push(["Premium", `$${lead.current_premium}`]);
  if (lead.quoted_premium) items.push(["Quoted", `$${lead.quoted_premium}`]);
  if (veh) items.push(["Vehicles", veh]);
  if (lead.x_date) items.push(["X-date", String(lead.x_date)]);
  if (lead.date_of_birth) items.push(["DOB", String(lead.date_of_birth)]);
  if (lead.email) items.push(["Email", lead.email]);
  if (items.length === 0) return null;
  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Lead snapshot — use in conversation
      </p>
      <dl className="grid grid-cols-1 gap-x-3 gap-y-0.5 text-xs sm:grid-cols-2">
        {items.map(([k, v]) => (
          <div key={k} className="flex gap-1.5">
            <dt className="shrink-0 text-muted-foreground">{k}:</dt>
            <dd className="truncate font-medium" title={v}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CopyLineButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={async (e) => {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* noop */
          }
        }}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy line"}
      </Button>
    </div>
  );
}