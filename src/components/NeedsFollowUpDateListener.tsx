import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarPlus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { playFollowUpSound } from "@/components/FollowUpDueAlertsListener";
import { useAlertPrefs } from "@/components/AlertPrefsSection";

type Item = {
  key: string; // `${table}:${id}:${side}`
  leadId: string;
  leadTable: "leads" | "list_leads";
  side: "auto" | "home";
  fullName: string;
  phone: string | null;
};

const DISMISS_KEY = "lv:dismissed-needs-date";
const CHIME_KEY = "lv:chimed-needs-date";

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

function fullNameOf(r: { first_name: string | null; last_name: string | null }) {
  return [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "Lead";
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

export function NeedsFollowUpDateListener() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: prefs } = useAlertPrefs();
  const enabled = (prefs?.needs_follow_up_date_alert ?? true) && !!user;
  const [items, setItems] = useState<Item[]>([]);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    loadedRef.current = true;
    let cancelled = false;

    (async () => {
      const uid = user.id;
      const [autoLeads, autoListLeads, homeLeads, homeListLeads] = await Promise.all([
        supabase
          .from("leads")
          .select("id, first_name, last_name, phone")
          .or(`claimed_by.eq.${uid},agent_id.eq.${uid}`)
          .is("archived_at", null)
          .eq("dispo", "follow_up")
          .is("follow_up_at", null),
        supabase
          .from("list_leads")
          .select("id, first_name, last_name, phone")
          .or(`claimed_by.eq.${uid},agent_id.eq.${uid}`)
          .eq("dispo", "follow_up")
          .is("follow_up_at", null),
        supabase
          .from("leads")
          .select("id, first_name, last_name, phone")
          .eq("home_claimed_by", uid)
          .is("archived_at", null)
          .eq("home_dispo", "follow_up")
          .is("home_follow_up_at", null),
        supabase
          .from("list_leads")
          .select("id, first_name, last_name, phone")
          .eq("home_claimed_by", uid)
          .eq("home_dispo", "follow_up")
          .is("home_follow_up_at", null),
      ]);
      if (cancelled) return;

      const rows: Item[] = [];
      const push = (
        data: unknown,
        table: "leads" | "list_leads",
        side: "auto" | "home",
      ) => {
        const list = Array.isArray(data) ? (data as any[]) : [];
        for (const r of list) {
          if (!r?.id) continue;
          rows.push({
            key: `${table}:${r.id}:${side}`,
            leadId: r.id,
            leadTable: table,
            side,
            fullName: fullNameOf(r),
            phone: r.phone ?? null,
          });
        }
      };
      push(autoLeads.data, "leads", "auto");
      push(autoListLeads.data, "list_leads", "auto");
      push(homeLeads.data, "leads", "home");
      push(homeListLeads.data, "list_leads", "home");

      const dismissed = loadSet(DISMISS_KEY, localStorage);
      const visible = rows.filter((r) => !dismissed.has(r.key));
      if (visible.length === 0) return;

      // One soft chime per session on first appearance.
      const chimed = loadSet(CHIME_KEY, sessionStorage);
      const fresh = visible.some((r) => !chimed.has(r.key));
      if (fresh) {
        for (const r of visible) chimed.add(r.key);
        saveSet(CHIME_KEY, sessionStorage, chimed);
        playFollowUpSound();
      }
      setItems(visible);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, user]);

  const dismiss = (item: Item) => {
    const d = loadSet(DISMISS_KEY, localStorage);
    d.add(item.key);
    saveSet(DISMISS_KEY, localStorage, d);
    setItems((prev) => prev.filter((i) => i.key !== item.key));
  };

  const open = (item: Item) => {
    dismiss(item);
    navigate({
      to: "/my-leads",
      search: { openLead: `${item.leadTable}:${item.leadId}` },
    });
  };

  if (!enabled || items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2">
      <AnimatePresence initial={false}>
        {items.map((item) => (
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
                "0 20px 60px rgba(0,0,0,0.55), 0 0 40px rgba(251,191,36,0.18)",
            }}
          >
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-3 py-1.5">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span
                    className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                    style={{ background: "#FBBF24" }}
                  />
                  <span
                    className="relative inline-flex h-2 w-2 rounded-full"
                    style={{ background: "#FBBF24" }}
                  />
                </span>
                <span
                  className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: "#FBBF24" }}
                >
                  <CalendarPlus className="h-3 w-3" /> Needs follow-up date
                </span>
              </div>
              <button
                onClick={() => dismiss(item)}
                className="rounded p-0.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
                aria-label="Dismiss alert"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="flex items-center gap-3 p-3">
              <div
                className="h-fit rounded-sm px-2 py-0.5 text-[11px] font-bold uppercase text-[#020617]"
                style={{ background: "#FBBF24" }}
              >
                {item.side}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <h3 className="truncate text-[13px] font-bold uppercase leading-tight tracking-tight text-white">
                  {item.fullName}
                </h3>
                {item.phone && (
                  <span className="mt-0.5 font-mono text-[11px] text-slate-400">
                    {formatPhone(item.phone)}
                  </span>
                )}
                <span className="mt-1 text-[11px] leading-snug text-slate-400">
                  Marked Follow-up with no date — pick a time so it lands on
                  your calendar.
                </span>
              </div>
              <button
                onClick={() => open(item)}
                className="inline-flex shrink-0 items-center justify-center gap-1 rounded-full bg-white px-4 py-1 text-[11px] font-bold text-[#020617] transition-colors hover:bg-slate-100"
              >
                Set date
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export default NeedsFollowUpDateListener;