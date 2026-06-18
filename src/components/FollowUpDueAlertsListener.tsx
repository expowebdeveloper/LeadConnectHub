import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Phone, X, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useAlertPrefs } from "@/components/AlertPrefsSection";

export type FollowUpDueAlertItem = {
  key: string; // `${leadTable}:${leadId}:${side}`
  leadId: string;
  leadTable: "leads" | "list_leads";
  side: "auto" | "home";
  fullName: string;
  phone: string | null;
  dueAt: string;
};

const MAX_VISIBLE = 20;
const POLL_MS = 60_000;
const DISMISSED_KEY = "lv:dismissed-followups";
const PINGED_KEY = "lv:pinged-followups";

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

function loadPinged(): Set<string> {
  try {
    const raw = sessionStorage.getItem(PINGED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

function savePinged(ids: Set<string>) {
  try {
    sessionStorage.setItem(PINGED_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    /* ignore */
  }
}

function formatPhone(raw: string | null): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1"))
    return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10)
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

function formatDue(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function playChime() {
  try {
    const AC =
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 520;
    o.type = "sine";
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    o.start();
    o.stop(ctx.currentTime + 0.45);
    setTimeout(() => ctx.close().catch(() => {}), 700);
  } catch {
    /* ignore */
  }
}

export const playFollowUpSound = playChime;

function fullNameOf(r: { first_name: string | null; last_name: string | null }) {
  return [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "Lead";
}

export function FollowUpDueAlertCard({
  item,
  onOpen,
  onDismiss,
}: {
  item: FollowUpDueAlertItem;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className="w-[360px] min-h-[112px] overflow-hidden rounded-lg border border-slate-800 bg-[#0f172a] pointer-events-auto"
      style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.55), 0 0 40px rgba(251,191,36,0.18)" }}
    >
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: "#FBBF24" }} />
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "#FBBF24" }} />
          </span>
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: "#FBBF24" }}>
            <Clock className="h-3 w-3" /> Follow-up due
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-slate-500">Due {formatDue(item.dueAt)}</span>
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
            className="h-fit rounded-sm px-2 py-0.5 text-[11px] font-bold text-[#020617] uppercase"
            style={{ background: "#FBBF24" }}
          >
            {item.side}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-col">
            <h3 className="truncate text-[13px] font-bold uppercase leading-tight tracking-tight text-white">
              {item.fullName}
            </h3>
            {item.phone && (
              <div className="mt-0.5 flex items-center gap-1.5">
                <div className="rounded p-1" style={{ background: "rgba(251,191,36,0.10)" }}>
                  <Phone className="h-3 w-3" style={{ color: "#FBBF24" }} />
                </div>
                <span className="font-mono text-[12px] font-medium text-slate-300">
                  {formatPhone(item.phone)}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end justify-between">
          <button
            onClick={onOpen}
            className="inline-flex items-center justify-center gap-1 rounded-full bg-white px-4 py-1 text-[11px] font-bold text-[#020617] transition-colors hover:bg-slate-100"
          >
            Open
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export function FollowUpDueAlertsListener() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: prefs } = useAlertPrefs();
  const enabled = (prefs?.follow_up_alert ?? true) && !!user;

  const [alerts, setAlerts] = useState<FollowUpDueAlertItem[]>([]);
  const pingedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !user) return;
    let cancelled = false;

    // Hydrate pinged set from sessionStorage + persisted dismissals so we don't
    // re-chime for alerts the user has already seen this session.
    const seeded = loadPinged();
    for (const k of loadDismissed()) seeded.add(k);
    pingedRef.current = seeded;

    const poll = async () => {
      const uid = user.id;
      const nowIso = new Date().toISOString();
      const [autoLeads, autoListLeads, homeLeads, homeListLeads] = await Promise.all([
        supabase
          .from("leads")
          .select("id, first_name, last_name, phone, follow_up_at")
          .or(`claimed_by.eq.${uid},agent_id.eq.${uid}`)
          .is("archived_at", null)
          .eq("dispo", "follow_up")
          .not("follow_up_at", "is", null)
          .lte("follow_up_at", nowIso),
        supabase
          .from("list_leads")
          .select("id, first_name, last_name, phone, follow_up_at")
          .or(`claimed_by.eq.${uid},agent_id.eq.${uid}`)
          .eq("dispo", "follow_up")
          .not("follow_up_at", "is", null)
          .lte("follow_up_at", nowIso),
        supabase
          .from("leads")
          .select("id, first_name, last_name, phone, home_follow_up_at")
          .eq("home_claimed_by", uid)
          .is("archived_at", null)
          .eq("home_dispo", "follow_up")
          .not("home_follow_up_at", "is", null)
          .lte("home_follow_up_at", nowIso),
        supabase
          .from("list_leads")
          .select("id, first_name, last_name, phone, home_follow_up_at")
          .eq("home_claimed_by", uid)
          .eq("home_dispo", "follow_up")
          .not("home_follow_up_at", "is", null)
          .lte("home_follow_up_at", nowIso),
      ]);
      if (cancelled) return;

      const items: FollowUpDueAlertItem[] = [];
      const push = (
        rows: unknown,
        table: "leads" | "list_leads",
        side: "auto" | "home",
        col: "follow_up_at" | "home_follow_up_at",
      ) => {
        const list = Array.isArray(rows) ? (rows as any[]) : [];
        for (const r of list) {
          if (!r?.id || !r?.[col]) continue;
          items.push({
            // Include due timestamp so a rescheduled follow-up generates a new
            // key and can alert again — while the previously dismissed time
            // stays suppressed.
            key: `${table}:${r.id}:${side}:${r[col]}`,
            leadId: r.id,
            leadTable: table,
            side,
            fullName: fullNameOf(r),
            phone: r.phone ?? null,
            dueAt: r[col],
          });
        }
      };
      push(autoLeads.data, "leads", "auto", "follow_up_at");
      push(autoListLeads.data, "list_leads", "auto", "follow_up_at");
      push(homeLeads.data, "leads", "home", "home_follow_up_at");
      push(homeListLeads.data, "list_leads", "home", "home_follow_up_at");

      const dismissed = loadDismissed();
      const live = items.filter((i) => !dismissed.has(i.key));

      // Note: we intentionally do NOT prune the dismissed set here. A poll
      // that returns no rows (transient empty response, the lead momentarily
      // filtered out, etc.) would otherwise wipe dismissals and cause an
      // already-dismissed alert to re-pop on the next successful poll. The
      // dismissed key already encodes the due timestamp, so rescheduling
      // produces a fresh key and a fresh alert with no pruning needed.

      // Ping for any newly-seen alert.
      let anyNew = false;
      for (const i of live) {
        if (!pingedRef.current.has(i.key)) {
          pingedRef.current.add(i.key);
          anyNew = true;
        }
      }
      if (anyNew) {
        savePinged(pingedRef.current);
        playChime();
      }

      // Replace state with the latest set, preserving newest-first by dueAt desc.
      live.sort((a, b) => new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime());
      setAlerts(live.slice(0, MAX_VISIBLE));
    };

    poll();
    const interval = window.setInterval(poll, POLL_MS);
    const onFocus = () => poll();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, user]);

  // Local-only test alert (Settings → "Send test alert")
  useEffect(() => {
    if (!enabled) return;
    const handler = () => {
      const key = `test-${Date.now()}`;
      const fake: FollowUpDueAlertItem = {
        key,
        leadId: key,
        leadTable: "leads",
        side: "auto",
        fullName: "Test Follow-up",
        phone: "5551234567",
        dueAt: new Date().toISOString(),
      };
      pingedRef.current.add(key);
      playChime();
      setAlerts((prev) => [fake, ...prev].slice(0, MAX_VISIBLE));
    };
    window.addEventListener("lovable:test-followup-alert", handler);
    return () => window.removeEventListener("lovable:test-followup-alert", handler);
  }, [enabled]);

  const onOpen = (item: FollowUpDueAlertItem) => {
    setAlerts((prev) => prev.filter((a) => a.key !== item.key));
    if (item.key.startsWith("test-")) return;
    // Opening the lead implicitly dismisses the alert so the next poll
    // doesn't re-add it.
    const d = loadDismissed();
    d.add(item.key);
    saveDismissed(d);
    navigate({
      to: "/my-leads",
      search: { openLead: `${item.leadTable}:${item.leadId}` },
    });
  };

  const onDismiss = (item: FollowUpDueAlertItem) => {
    if (!item.key.startsWith("test-")) {
      const d = loadDismissed();
      d.add(item.key);
      saveDismissed(d);
    }
    setAlerts((prev) => prev.filter((a) => a.key !== item.key));
  };

  if (!enabled) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-50 flex flex-row-reverse flex-wrap-reverse items-start content-start gap-2">
      <AnimatePresence initial={false}>
        {alerts.map((item) => (
          <FollowUpDueAlertCard
            key={item.key}
            item={item}
            onOpen={() => onOpen(item)}
            onDismiss={() => onDismiss(item)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

export default FollowUpDueAlertsListener;