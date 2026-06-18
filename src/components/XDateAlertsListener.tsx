import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, X, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useAlertPrefs } from "@/components/AlertPrefsSection";
import { playFollowUpSound } from "@/components/FollowUpDueAlertsListener";

type Item = {
  key: string; // `${table}:${id}:${side}:${xDate}`
  leadId: string;
  leadTable: "leads" | "list_leads";
  side: "auto" | "home";
  fullName: string;
  phone: string | null;
  xDate: string;
};

const MAX_VISIBLE = 20;
const POLL_MS = 5 * 60_000;
const WINDOW_DAYS = 14;
const DISMISSED_KEY = "lv:dismissed-xdates";
const PINGED_KEY = "lv:pinged-xdates";

function loadSet(key: string, store: Storage): Set<string> {
  try {
    const raw = store.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSet(key: string, store: Storage, ids: Set<string>) {
  try {
    store.setItem(key, JSON.stringify(Array.from(ids)));
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

function formatXDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function fullNameOf(r: { first_name: string | null; last_name: string | null }) {
  return [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "Lead";
}

export function XDateAlertsListener() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: prefs } = useAlertPrefs();
  const enabled = (prefs?.x_date_alert ?? true) && !!user;

  const [alerts, setAlerts] = useState<Item[]>([]);
  const pingedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !user) return;
    let cancelled = false;

    const seeded = loadSet(PINGED_KEY, sessionStorage);
    for (const k of loadSet(DISMISSED_KEY, localStorage)) seeded.add(k);
    pingedRef.current = seeded;

    const poll = async () => {
      const uid = user.id;
      const now = new Date();
      const horizon = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const nowIso = now.toISOString().slice(0, 10);
      const horizonIso = horizon.toISOString().slice(0, 10);

      const [autoLeads, autoListLeads, homeLeads, homeListLeads] = await Promise.all([
        supabase
          .from("leads")
          .select("id, first_name, last_name, phone, x_date")
          .or(`claimed_by.eq.${uid},agent_id.eq.${uid}`)
          .is("archived_at", null)
          .not("x_date", "is", null)
          .gte("x_date", nowIso)
          .lte("x_date", horizonIso),
        supabase
          .from("list_leads")
          .select("id, first_name, last_name, phone, x_date")
          .or(`claimed_by.eq.${uid},agent_id.eq.${uid}`)
          .not("x_date", "is", null)
          .gte("x_date", nowIso)
          .lte("x_date", horizonIso),
        supabase
          .from("leads")
          .select("id, first_name, last_name, phone, home_x_date")
          .eq("home_claimed_by", uid)
          .is("archived_at", null)
          .not("home_x_date", "is", null)
          .gte("home_x_date", nowIso)
          .lte("home_x_date", horizonIso),
        supabase
          .from("list_leads")
          .select("id, first_name, last_name, phone, home_x_date")
          .eq("home_claimed_by", uid)
          .not("home_x_date", "is", null)
          .gte("home_x_date", nowIso)
          .lte("home_x_date", horizonIso),
      ]);
      if (cancelled) return;

      const items: Item[] = [];
      const push = (
        rows: unknown,
        table: "leads" | "list_leads",
        side: "auto" | "home",
        col: "x_date" | "home_x_date",
      ) => {
        const list = Array.isArray(rows) ? (rows as any[]) : [];
        for (const r of list) {
          if (!r?.id || !r?.[col]) continue;
          items.push({
            key: `${table}:${r.id}:${side}:${r[col]}`,
            leadId: r.id,
            leadTable: table,
            side,
            fullName: fullNameOf(r),
            phone: r.phone ?? null,
            xDate: r[col],
          });
        }
      };
      push(autoLeads.data, "leads", "auto", "x_date");
      push(autoListLeads.data, "list_leads", "auto", "x_date");
      push(homeLeads.data, "leads", "home", "home_x_date");
      push(homeListLeads.data, "list_leads", "home", "home_x_date");

      const dismissed = loadSet(DISMISSED_KEY, localStorage);
      const live = items.filter((i) => !dismissed.has(i.key));

      let anyNew = false;
      for (const i of live) {
        if (!pingedRef.current.has(i.key)) {
          pingedRef.current.add(i.key);
          anyNew = true;
        }
      }
      if (anyNew) {
        saveSet(PINGED_KEY, sessionStorage, pingedRef.current);
        playFollowUpSound();
      }

      live.sort((a, b) => new Date(a.xDate).getTime() - new Date(b.xDate).getTime());
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

  const onOpen = (item: Item) => {
    setAlerts((prev) => prev.filter((a) => a.key !== item.key));
    const d = loadSet(DISMISSED_KEY, localStorage);
    d.add(item.key);
    saveSet(DISMISSED_KEY, localStorage, d);
    navigate({
      to: "/my-leads",
      search: { openLead: `${item.leadTable}:${item.leadId}` },
    });
  };

  const onDismiss = (item: Item) => {
    const d = loadSet(DISMISSED_KEY, localStorage);
    d.add(item.key);
    saveSet(DISMISSED_KEY, localStorage, d);
    setAlerts((prev) => prev.filter((a) => a.key !== item.key));
  };

  if (!enabled || alerts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex flex-col-reverse gap-2">
      <AnimatePresence initial={false}>
        {alerts.map((item) => (
          <motion.div
            key={item.key}
            layout
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96, transition: { duration: 0.18 } }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="pointer-events-auto w-[360px] overflow-hidden rounded-lg border border-slate-800 bg-[#0f172a]"
            style={{
              boxShadow:
                "0 20px 60px rgba(0,0,0,0.55), 0 0 40px rgba(139,92,246,0.18)",
            }}
          >
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-3 py-1.5">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span
                    className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                    style={{ background: "#A78BFA" }}
                  />
                  <span
                    className="relative inline-flex h-2 w-2 rounded-full"
                    style={{ background: "#A78BFA" }}
                  />
                </span>
                <span
                  className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: "#A78BFA" }}
                >
                  <CalendarClock className="h-3 w-3" /> Renewal approaching
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-slate-500">
                  {formatXDate(item.xDate)}
                </span>
                <button
                  onClick={() => onDismiss(item)}
                  className="rounded p-0.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
                  aria-label="Dismiss alert"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3">
              <div
                className="h-fit rounded-sm px-2 py-0.5 text-[11px] font-bold uppercase text-[#020617]"
                style={{ background: "#A78BFA" }}
              >
                {item.side}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <h3 className="truncate text-[13px] font-bold uppercase leading-tight tracking-tight text-white">
                  {item.fullName}
                </h3>
                {item.phone && (
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <Phone className="h-3 w-3 text-slate-500" />
                    <span className="font-mono text-[12px] text-slate-300">
                      {formatPhone(item.phone)}
                    </span>
                  </div>
                )}
              </div>
              <button
                onClick={() => onOpen(item)}
                className="inline-flex shrink-0 items-center justify-center gap-1 rounded-full bg-white px-4 py-1 text-[11px] font-bold text-[#020617] transition-colors hover:bg-slate-100"
              >
                Open
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export default XDateAlertsListener;