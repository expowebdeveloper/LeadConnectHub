import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Phone, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useHasRole } from "@/lib/auth";
import { useAlertPrefs } from "@/components/AlertPrefsSection";
import { lookupVendorNames } from "@/lib/admin.functions";

type LiveLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  num_vehicles: number | null;
  current_carrier: string | null;
  composite_score: number | null;
  score_tier: string | null;
  claimed_by: string | null;
  archived_at: string | null;
  created_at: string;
  vendor_id: string | null;
};

type AlertItem = LiveLead & {
  _status: "open" | "claiming";
  vendor_name?: string | null;
};

const MAX_VISIBLE = 20;

function formatPhone(raw: string | null): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) {
    return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return raw;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function playPing() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
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

export type LiveLeadAlertItem = AlertItem;

export const playLiveLeadSound = playPing;

export function LiveLeadAlertCard({
  lead,
  onClaim,
  onDismiss,
}: {
  lead: AlertItem;
  onClaim: () => void;
  onDismiss: () => void;
}) {
  const fullName = [lead.first_name, lead.last_name]
    .filter(Boolean)
    .join(" ")
    .trim() || "New Lead";

  const claiming = lead._status === "claiming";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className="w-[360px] min-h-[112px] overflow-hidden rounded-lg border border-slate-800 bg-[#0f172a] pointer-events-auto"
      style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.55), 0 0 40px rgba(52,211,153,0.18)" }}
    >
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">
            Live lead arrived
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-slate-500">{formatTime(lead.created_at)}</span>
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
          <div className="h-fit rounded-sm bg-[#34d399] px-2 py-0.5 text-[11px] font-bold text-[#020617] tabular-nums">
            {lead.composite_score ?? lead.score_tier ?? "—"}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-col">
            <h3 className="truncate text-[13px] font-bold uppercase leading-tight tracking-tight text-white">
              {fullName}
            </h3>
            {lead.phone && (
              <div className="mt-0.5 flex items-center gap-1.5">
                <div className="rounded bg-emerald-950/40 p-1">
                  <Phone className="h-3 w-3 text-emerald-500" />
                </div>
                <span className="font-mono text-[12px] font-medium text-slate-300">
                  {formatPhone(lead.phone)}
                </span>
              </div>
            )}
            {lead.vendor_id && (
              <div className="mt-1 flex items-center gap-1.5">
                {lead.vendor_name ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950/60 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                    {lead.vendor_name}
                  </span>
                ) : (
                  <span className="h-5 w-24 animate-pulse rounded-full bg-slate-800" />
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end justify-center">
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

export function LiveLeadAlertsListener() {
  const { user } = useAuth();
  const isSales = useHasRole("sales");
  const isAdmin = useHasRole("admin");
  const { data: prefs } = useAlertPrefs();
  const enabled = (prefs?.live_lead_alert ?? true) && (isSales || isAdmin);

  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  // Alerts persist until the lead is claimed (by this agent or another) or
  // manually dismissed — no auto-dismiss timer.

  useEffect(() => {
    if (!user || !enabled) return;

    const channel = supabase
      .channel("live_lead_alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "leads" },
        (payload) => {
          const lead = payload.new as LiveLead;
          if (!lead?.id || seenRef.current.has(lead.id)) return;
          if (lead.claimed_by || lead.archived_at) return;
          seenRef.current.add(lead.id);

          playPing();
          setAlerts((prev) => {
            const next: AlertItem = { ...lead, _status: "open" };
            return [next, ...prev].slice(0, MAX_VISIBLE);
          });

          if (lead.vendor_id) {
            lookupVendorNames({ data: { vendor_ids: [lead.vendor_id] } })
              .then((rows) => {
                const v = rows?.[0];
                if (!v) return;
                const name = v.company_name || v.full_name || v.email || null;
                setAlerts((prev) =>
                  prev.map((a) => (a.id === lead.id ? { ...a, vendor_name: name } : a)),
                );
              })
              .catch(() => {});
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "leads" },
        async (payload) => {
          const next = payload.new as LiveLead;
          if (!next?.id) return;
          // Fast path: if the realtime payload already shows this lead is
          // claimed (by me or anyone) or archived, dismiss immediately so the
          // 5s re-ping loop stops without waiting on a follow-up fetch.
          if (next.claimed_by || next.archived_at) {
            setAlerts((curr) => curr.filter((a) => a.id !== next.id));
            return;
          }
          // Only dismiss if THIS lead is one we're currently showing.
          // Many unrelated UPDATEs fire on a lead (scoring re-runs, notes,
          // dispo edits on other sides, etc.) — confirm the lead is truly
          // no longer available before dismissing.
          let isShown = false;
          setAlerts((curr) => {
            isShown = curr.some((a) => a.id === next.id);
            return curr;
          });
          if (!isShown) return;

          const { data: fresh } = await supabase
            .from("leads")
            .select("claimed_by, archived_at, dispo")
            .eq("id", next.id)
            .maybeSingle();
          if (!fresh) return;

          const isClaimed = !!fresh.claimed_by;
          const isArchived = !!fresh.archived_at;
          const hasDispo =
            !!fresh.dispo && String(fresh.dispo).trim().length > 0;

          if (isClaimed || isArchived || hasDispo) {
            setAlerts((curr) => curr.filter((a) => a.id !== next.id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, enabled]);

  // Local-only test alerts
  useEffect(() => {
    if (!enabled) return;
    const handler = () => {
      const id = `test-${Date.now()}`;
      const fake: AlertItem = {
        id,
        first_name: "Test",
        last_name: "Lead",
        phone: "5551234567",
        city: "Sample City",
        state: "FL",
        zip: "33101",
        num_vehicles: 2,
        current_carrier: "Geico",
        composite_score: 142,
        score_tier: "S",
        claimed_by: null,
        archived_at: null,
        created_at: new Date().toISOString(),
        vendor_id: null,
        vendor_name: "Acme Leads Co.",
        _status: "open",
      };
      playPing();
      setAlerts((prev) => [fake, ...prev].slice(0, MAX_VISIBLE));
    };
    window.addEventListener("lovable:test-lead-alert", handler);
    return () => window.removeEventListener("lovable:test-lead-alert", handler);
  }, [enabled]);

  const onClaimTest = (lead: AlertItem) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === lead.id ? { ...a, _status: "claiming" } : a)),
    );
    setTimeout(() => {
      toast.success("Test claim successful");
      setAlerts((prev) => prev.filter((a) => a.id !== lead.id));
    }, 400);
  };

  const onClaim = async (lead: AlertItem) => {
    if (lead.id.startsWith("test-")) {
      onClaimTest(lead);
      return;
    }
    if (!user) return;
    setAlerts((prev) =>
      prev.map((a) => (a.id === lead.id ? { ...a, _status: "claiming" } : a)),
    );
    const { data, error } = await supabase
      .from("leads")
      .update({ claimed_by: user.id })
      .eq("id", lead.id)
      .is("claimed_by", null)
      .is("archived_at", null)
      .select("id")
      .maybeSingle();

    if (error || !data) {
      const msg = error?.message?.includes("already claimed")
        ? "Another agent got there first."
        : error?.message || "Another agent got there first.";
      toast.error(msg);
      setAlerts((prev) => prev.filter((a) => a.id !== lead.id));
      return;
    }

    toast.success(`Claimed ${[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "lead"}`);
    setAlerts((prev) => prev.filter((a) => a.id !== lead.id));
  };

  const onDismiss = (lead: AlertItem) =>
    setAlerts((prev) => prev.filter((a) => a.id !== lead.id));

  // Re-ping every 5s while any alert is still open (unclaimed/undismissed).
  const hasOpenAlert = alerts.some((a) => a._status === "open");
  const alertsRef = useRef<AlertItem[]>([]);
  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);
  useEffect(() => {
    if (!enabled || !hasOpenAlert) return;
    const interval = setInterval(async () => {
      const current = alertsRef.current;
      const openIds = current
        .filter((a) => a._status === "open" && !a.id.startsWith("test-"))
        .map((a) => a.id);
      if (openIds.length) {
        try {
          const { data } = await supabase
            .from("leads")
            .select("id, claimed_by, archived_at, dispo")
            .in("id", openIds);
          const stale = new Set(
            (data ?? [])
              .filter(
                (r) =>
                  !!r.claimed_by ||
                  !!r.archived_at ||
                  (!!r.dispo && String(r.dispo).trim().length > 0),
              )
              .map((r) => r.id as string),
          );
          if (stale.size) {
            setAlerts((curr) => curr.filter((a) => !stale.has(a.id)));
          }
        } catch {
          /* ignore transient errors */
        }
      }
      const stillOpen = alertsRef.current.some((a) => a._status === "open");
      if (stillOpen) playPing();
    }, 5000);
    return () => clearInterval(interval);
  }, [enabled, hasOpenAlert]);

  if (!enabled) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-50 flex flex-row-reverse flex-wrap-reverse items-start content-start gap-2">
      <AnimatePresence initial={false}>
        {alerts.map((lead) => (
          <LiveLeadAlertCard
            key={lead.id}
            lead={lead}
            onClaim={() => onClaim(lead)}
            onDismiss={() => onDismiss(lead)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

export default LiveLeadAlertsListener;