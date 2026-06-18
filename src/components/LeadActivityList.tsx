import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { lookupProfileNames } from "@/lib/admin.functions";
import { DISPO_OPTIONS, type Dispo } from "@/lib/constants";
import { callOutcomeLabel } from "@/components/CallButton";

type Activity = {
  id: string;
  lead_id: string;
  lead_table: string;
  user_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
};

type OriginMeta = {
  created_at: string;
  vendor_id: string | null;
  list_type: string | null;
  lead_source: string | null;
  import_batch_id: string | null;
};

function formatListType(t: string | null | undefined): string {
  if (!t) return "";
  return t
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function dispoLabel(v: unknown): string {
  if (!v) return "—";
  const s = String(v) as Dispo;
  return DISPO_OPTIONS.find((d) => d.value === s)?.label ?? s;
}

function describe(a: Activity, nameOf: (id: string | null | undefined) => string): string {
  const d = a.details ?? {};
  switch (a.action) {
    case "claimed":
      return `Claimed by ${nameOf(a.user_id)}`;
    case "released":
      return `Released by ${nameOf(a.user_id)}`;
    case "reassigned":
      return `Reassigned by ${nameOf(a.user_id)} from ${nameOf((d as any).from)} to ${nameOf((d as any).to)}`;
    case "dispo_changed":
      return `Dispo changed by ${nameOf(a.user_id)}: ${dispoLabel((d as any).from)} → ${dispoLabel((d as any).to)}`;
    case "quoted_premium_changed": {
      const from = (d as any).from;
      const to = (d as any).to;
      const f = from != null ? `$${Number(from).toFixed(2)}` : "—";
      const t = to != null ? `$${Number(to).toFixed(2)}` : "—";
      return `Quoted premium changed by ${nameOf(a.user_id)}: ${f} → ${t}`;
    }
    case "agent_notes_edited":
      return `Agent notes edited by ${nameOf(a.user_id)}`;
    case "call_logged": {
      const outcome = callOutcomeLabel((d as any).outcome);
      const phone = (d as any).phone ? ` (${(d as any).phone})` : "";
      return `Call logged by ${nameOf(a.user_id)}: ${outcome}${phone}`;
    }
    case "line_added": {
      const label = (d as any).label ?? (d as any).type ?? "line";
      return `${label} line added by ${nameOf(a.user_id)}`;
    }
    case "line_removed": {
      const label = (d as any).label ?? (d as any).type ?? "line";
      return `${label} line removed by ${nameOf(a.user_id)}`;
    }
    default:
      return `${a.action} by ${nameOf(a.user_id)}`;
  }
}

export function LeadActivityList({
  leadId,
  leadTable,
}: {
  leadId: string;
  leadTable: "leads" | "list_leads";
}) {
  const lookupProfiles = useServerFn(lookupProfileNames);

  const activitiesQ = useQuery({
    queryKey: ["lead_activities", leadTable, leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_activities" as never)
        .select("*")
        .eq("lead_table", leadTable)
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data as unknown as Activity[]) ?? [];
    },
  });

  const originQ = useQuery({
    queryKey: ["lead_origin", leadTable, leadId],
    queryFn: async (): Promise<OriginMeta | null> => {
      const cols =
        leadTable === "list_leads"
          ? "created_at,vendor_id,list_type,lead_source,import_batch_id"
          : "created_at,vendor_id,lead_source";
      const { data, error } = await supabase
        .from(leadTable as never)
        .select(cols)
        .eq("id", leadId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const d = data as unknown as Partial<OriginMeta>;
      return {
        created_at: d.created_at as string,
        vendor_id: d.vendor_id ?? null,
        list_type: d.list_type ?? null,
        lead_source: d.lead_source ?? null,
        import_batch_id: d.import_batch_id ?? null,
      };
    },
  });

  const userIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of activitiesQ.data ?? []) {
      if (a.user_id) ids.add(a.user_id);
      const d = a.details ?? {};
      for (const k of ["from", "to", "claimed_by", "was_claimed_by"]) {
        const v = (d as any)[k];
        if (typeof v === "string" && v.length === 36) ids.add(v);
      }
    }
    if (originQ.data?.vendor_id) ids.add(originQ.data.vendor_id);
    return Array.from(ids);
  }, [activitiesQ.data, originQ.data]);

  const profilesQ = useQuery({
    queryKey: ["lead_activity_profiles", userIds],
    queryFn: () => lookupProfiles({ data: { user_ids: userIds } }),
    enabled: userIds.length > 0,
  });

  const nameOf = (id: string | null | undefined): string => {
    if (!id) return "system";
    const p = (profilesQ.data ?? []).find((x) => x.id === id);
    if (p) return p.full_name || p.email;
    return "someone";
  };

  if (activitiesQ.isLoading) {
    return <div className="text-xs text-muted-foreground">Loading activity…</div>;
  }

  const rows = activitiesQ.data ?? [];
  const origin = originQ.data ?? null;
  if (rows.length === 0 && !origin) {
    return <div className="text-xs text-muted-foreground">No activity recorded yet.</div>;
  }

  const originLabel = (() => {
    if (!origin) return null;
    const who = nameOf(origin.vendor_id);
    if (leadTable === "list_leads") {
      const lt = formatListType(origin.list_type);
      const kind = origin.import_batch_id
        ? `Imported${lt ? ` as ${lt}` : ""}`
        : lt
          ? `Added as ${lt}`
          : "Added to list";
      return `${kind} by ${who}`;
    }
    const src = origin.lead_source ? ` (${origin.lead_source})` : "";
    return `Lead created${src} by ${who}`;
  })();

  return (
    <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
      {rows.map((a) => (
        <li key={a.id} className="flex items-start justify-between gap-3 text-xs">
          <span className="text-foreground">{describe(a, nameOf)}</span>
          <span className="whitespace-nowrap text-muted-foreground">
            {new Date(a.created_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              ...(a.action === "call_logged" ? { second: "2-digit" } : {}),
            })}
          </span>
        </li>
      ))}
      {origin && originLabel && (
        <li key="__origin" className="flex items-start justify-between gap-3 text-xs border-t border-border pt-2">
          <span className="text-foreground font-medium">{originLabel}</span>
          <span className="whitespace-nowrap text-muted-foreground">
            {new Date(origin.created_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </li>
      )}
    </ul>
  );
}