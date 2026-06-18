import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Phone, X, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useAlertPrefs } from "@/components/AlertPrefsSection";
import { LINE_TYPE_META, type LineType } from "@/lib/constants";
import { AgentAvatar } from "@/components/AgentAvatar";

type ShareRow = {
  id: string;
  lead_id: string;
  lead_table: "leads" | "list_leads";
  line_id: string | null;
  shared_by: string;
  shared_with: string;
};

type AlertItem = {
  shareId: string;
  leadId: string;
  leadTable: "leads" | "list_leads";
  lineId: string | null;
  lineLabel: string;
  fullName: string;
  phone: string | null;
  cityState: string;
  zip: string | null;
  numVehicles: number | null;
  currentCarrier: string | null;
  composite: number | null;
  tier: string | null;
  createdAt: string;
  sharerName: string;
  sharerAvatar: string | null;
  _status: "open" | "claiming";
};

const MAX_VISIBLE = 20;
const DISMISSED_KEY = "lv:dismissed-shares";

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    /* ignore */
  }
}

function isLineClaimed(
  lineId: string | null,
  leadRow: {
    claimed_by: string | null;
    home_claimed_by: string | null;
    lead_lines?: unknown;
  } | null,
): boolean {
  if (!leadRow) return true; // lead missing → treat as gone
  if (lineId === "home") return !!leadRow.home_claimed_by;
  if (lineId === "auto" || lineId == null) return !!leadRow.claimed_by;
  const lines = Array.isArray(leadRow.lead_lines)
    ? (leadRow.lead_lines as Array<{ line_id?: string; claimed_by?: string | null }>)
    : [];
  const entry = lines.find((l) => l.line_id === lineId);
  if (!entry) return true; // extra line removed → dismiss
  return !!entry.claimed_by;
}

function formatPhone(raw: string | null): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function playPing() {
  try {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 660;
    o.type = "sine";
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.start();
    o.stop(ctx.currentTime + 0.4);
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch {
    /* ignore */
  }
}

function lineLabelFor(lineId: string | null): string {
  if (!lineId) return "Lead";
  if (lineId === "auto") return "Auto";
  if (lineId === "home") return "Home";
  if (lineId === "renter") return "Renters";
  const meta = LINE_TYPE_META[lineId as LineType];
  if (meta) return meta.label;
  // line_id might be a uuid for an extra line — fall back to "Line"
  return "Line";
}

export type SharedLeadAlertItem = AlertItem;

export const playSharedLeadSound = playPing;

export function SharedLeadAlertCard({ item, onClaim, onDismiss }: { item: AlertItem; onClaim: () => void; onDismiss: () => void }) {
  const claiming = item._status === "claiming";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className="w-[360px] min-h-[112px] overflow-hidden rounded-lg border border-slate-800 bg-[#0f172a] pointer-events-auto"
      style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.55), 0 0 40px rgba(245,255,58,0.18)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: "#F5FF3A" }} />
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "#F5FF3A" }} />
          </span>
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: "#F5FF3A" }}>
            <Share2 className="h-3 w-3" /> Lead shared with you
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-slate-500">{formatTime(item.createdAt)}</span>
          <button
            onClick={onDismiss}
            className="rounded p-0.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
            aria-label="Dismiss alert"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 p-3">
        <div className="shrink-0">
          <div
            className="h-fit rounded-sm px-2 py-0.5 text-[11px] font-bold uppercase text-[#020617]"
            style={{ background: "#F5FF3A" }}
          >
            {item.lineLabel}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-col">
            <h3 className="truncate text-[13px] font-bold uppercase leading-tight tracking-tight text-white">
              {item.fullName}
            </h3>
            {item.phone && (
              <div className="mt-0.5 flex items-center gap-1.5">
                <div className="rounded p-1" style={{ background: "rgba(245,255,58,0.10)" }}>
                  <Phone className="h-3 w-3" style={{ color: "#F5FF3A" }} />
                </div>
                <span className="font-mono text-[12px] font-medium text-slate-300">{formatPhone(item.phone)}</span>
              </div>
            )}
            <div className="mt-1 flex items-center gap-1.5">
              <AgentAvatar size="xs" name={item.sharerName} path={item.sharerAvatar} />
              <span className="truncate font-mono text-[10px] text-slate-500">
                via {item.sharerName}
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end justify-between">
          <button
            onClick={onClaim}
            disabled={claiming}
            className="inline-flex items-center justify-center gap-1 rounded-full bg-white px-4 py-1 text-[11px] font-bold text-[#020617] transition-colors hover:bg-slate-100 disabled:cursor-not-allowed"
          >
            {claiming ? <Loader2 className="h-3 w-3 animate-spin" /> : "Claim"}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export function LeadShareAlertsListener() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: prefs } = useAlertPrefs();
  const enabled = (prefs?.share_alert ?? true) && !!user;

  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const alertsRef = useRef<AlertItem[]>([]);
  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);

  useEffect(() => {
    if (!user || !enabled) return;
    let cancelled = false;

    const buildAlertItem = async (
      row: ShareRow,
      createdAt?: string,
    ): Promise<{ item: AlertItem; leadClaimed: boolean } | null> => {
      const leadTable = row.lead_table;
      const cols =
        "first_name, last_name, phone, city, state, zip, num_vehicles, current_carrier, composite_score, score_tier, claimed_by, home_claimed_by, lead_lines";
      const [leadRes, profRes] = await Promise.all([
        (supabase.from(leadTable) as any).select(cols).eq("id", row.lead_id).maybeSingle(),
        supabase
          .from("profiles")
          .select("full_name, email, avatar_url")
          .eq("id", row.shared_by)
          .maybeSingle(),
      ]);
      const lead = leadRes.data as
        | {
            first_name: string | null; last_name: string | null; phone: string | null;
            city: string | null; state: string | null; zip: string | null;
            num_vehicles: number | null; current_carrier: string | null;
            composite_score: number | null; score_tier: string | null;
            claimed_by: string | null; home_claimed_by: string | null;
            lead_lines: unknown;
          }
        | null;
      const prof = profRes.data as
        | { full_name: string | null; email: string | null; avatar_url: string | null }
        | null;
      if (!lead) return null;
      const item: AlertItem = {
        shareId: row.id,
        leadId: row.lead_id,
        leadTable,
        lineId: row.line_id,
        lineLabel: lineLabelFor(row.line_id),
        fullName:
          [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || "Shared Lead",
        phone: lead.phone,
        cityState: [lead.city, lead.state].filter(Boolean).join(", "),
        zip: lead.zip,
        numVehicles: lead.num_vehicles,
        currentCarrier: lead.current_carrier,
        composite: lead.composite_score,
        tier: lead.score_tier,
        createdAt: createdAt ?? new Date().toISOString(),
        sharerName: prof?.full_name || prof?.email || "A teammate",
        sharerAvatar: prof?.avatar_url ?? null,
        _status: "open",
      };
      return { item, leadClaimed: isLineClaimed(row.line_id, lead) };
    };

    const handleInsert = async (row: ShareRow) => {
      if (!row?.id || seenRef.current.has(row.id)) return;
      if (row.shared_with !== user.id) return;
      if (row.shared_by === user.id) return;
      const dismissed = loadDismissed();
      if (dismissed.has(row.id)) return;
      seenRef.current.add(row.id);
      const built = await buildAlertItem(row);
      if (!built || built.leadClaimed || cancelled) return;
      playPing();
      setAlerts((prev) => [built.item, ...prev].slice(0, MAX_VISIBLE));
    };

    // 1) Hydrate persistent unclaimed shares for this user on mount.
    (async () => {
      const { data, error } = await supabase
        .from("lead_shares")
        .select("id, lead_id, lead_table, line_id, shared_by, shared_with, created_at")
        .eq("shared_with", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (cancelled || error || !data) return;
      const dismissed = loadDismissed();
      // Prune dismissed-ids that no longer correspond to a live share.
      const liveIds = new Set(data.map((r) => r.id));
      const pruned = new Set(Array.from(dismissed).filter((id) => liveIds.has(id)));
      if (pruned.size !== dismissed.size) saveDismissed(pruned);
      const surviving = data.filter(
        (r) => r.shared_by !== user.id && !pruned.has(r.id),
      );
      const built = await Promise.all(
        surviving.map((r) =>
          buildAlertItem(r as ShareRow, r.created_at as string | undefined),
        ),
      );
      if (cancelled) return;
      const items = built
        .filter((b): b is { item: AlertItem; leadClaimed: boolean } => !!b && !b.leadClaimed)
        .map((b) => b.item)
        .reverse(); // oldest first so newest stays on top after slice
      items.forEach((i) => seenRef.current.add(i.shareId));
      if (items.length) {
        setAlerts((prev) => {
          const existingIds = new Set(prev.map((p) => p.shareId));
          const merged = [...items.filter((i) => !existingIds.has(i.shareId)), ...prev];
          return merged.slice(0, MAX_VISIBLE);
        });
      }
    })();

    const channel = supabase
      .channel("lead_share_alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "lead_shares", filter: `shared_with=eq.${user.id}` },
        (payload) => handleInsert(payload.new as ShareRow),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "lead_shares" },
        (payload) => {
          const old = payload.old as { id?: string } | null;
          const id = old?.id;
          if (!id) return;
          setAlerts((prev) => prev.filter((a) => a.shareId !== id));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "leads" },
        (payload) => {
          const next = payload.new as {
            id?: string;
            claimed_by?: string | null;
            home_claimed_by?: string | null;
            lead_lines?: unknown;
          } | null;
          if (!next?.id) return;
          const matches = alertsRef.current.filter(
            (a) => a.leadTable === "leads" && a.leadId === next.id,
          );
          if (!matches.length) return;
          for (const a of matches) {
            if (
              isLineClaimed(a.lineId, {
                claimed_by: next.claimed_by ?? null,
                home_claimed_by: next.home_claimed_by ?? null,
                lead_lines: next.lead_lines,
              })
            ) {
              setAlerts((prev) => prev.filter((p) => p.shareId !== a.shareId));
            }
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "list_leads" },
        (payload) => {
          const next = payload.new as {
            id?: string;
            claimed_by?: string | null;
            home_claimed_by?: string | null;
            lead_lines?: unknown;
          } | null;
          if (!next?.id) return;
          const matches = alertsRef.current.filter(
            (a) => a.leadTable === "list_leads" && a.leadId === next.id,
          );
          if (!matches.length) return;
          for (const a of matches) {
            if (
              isLineClaimed(a.lineId, {
                claimed_by: next.claimed_by ?? null,
                home_claimed_by: next.home_claimed_by ?? null,
                lead_lines: next.lead_lines,
              })
            ) {
              setAlerts((prev) => prev.filter((p) => p.shareId !== a.shareId));
            }
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user, enabled]);

  const onClaim = async (item: AlertItem) => {
    if (!user) return;
    setAlerts((prev) =>
      prev.map((a) => (a.shareId === item.shareId ? { ...a, _status: "claiming" } : a)),
    );
    try {
      const nowIso = new Date().toISOString();
      const lineId = item.lineId;
      if (lineId === "auto" || lineId === "home" || lineId == null) {
        // Treat null line as auto-side (default lead claim).
        const patch =
          lineId === "home"
            ? { home_claimed_by: user.id, home_claimed_at: nowIso }
            : { claimed_by: user.id, claimed_at: nowIso };
        const { error } = await (supabase.from(item.leadTable) as any)
          .update(patch)
          .eq("id", item.leadId);
        if (error) throw error;
      } else {
        // Extra line stored in lead_lines jsonb — read, patch, upsert via RPC.
        const { data: row, error: readErr } = await (supabase.from(item.leadTable) as any)
          .select("lead_lines")
          .eq("id", item.leadId)
          .maybeSingle();
        if (readErr) throw readErr;
        const lines: Array<Record<string, unknown>> = Array.isArray(row?.lead_lines)
          ? (row!.lead_lines as Array<Record<string, unknown>>)
          : [];
        const target = lines.find((l) => (l as { line_id?: string }).line_id === lineId);
        if (!target) throw new Error("Shared line no longer exists");
        const patched = { ...target, claimed_by: user.id, claimed_at: nowIso };
        const { error: upErr } = await (supabase.rpc as any)("lead_line_upsert", {
          p_table: item.leadTable,
          p_lead_id: item.leadId,
          p_line: patched,
        });
        if (upErr) throw upErr;
      }

      // Accept the share — remove the notification row.
      await supabase.from("lead_shares").delete().eq("id", item.shareId);

      toast.success(`Claimed ${item.lineLabel} for ${item.fullName}`);
      navigate({ to: "/leads/$leadId", params: { leadId: item.leadId } });
      setAlerts((prev) => prev.filter((a) => a.shareId !== item.shareId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to claim");
      setAlerts((prev) =>
        prev.map((a) => (a.shareId === item.shareId ? { ...a, _status: "open" } : a)),
      );
    }
  };

  const onDismiss = (item: AlertItem) => {
    const dismissed = loadDismissed();
    dismissed.add(item.shareId);
    saveDismissed(dismissed);
    setAlerts((prev) => prev.filter((a) => a.shareId !== item.shareId));
  };

  if (!enabled) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-50 flex flex-row-reverse flex-wrap-reverse items-start content-start gap-2">
      <AnimatePresence initial={false}>
        {alerts.map((item) => (
          <SharedLeadAlertCard
            key={item.shareId}
            item={item}
            onClaim={() => onClaim(item)}
            onDismiss={() => onDismiss(item)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

export default LeadShareAlertsListener;