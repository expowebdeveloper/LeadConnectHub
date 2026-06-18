import chimeAsset from "@/assets/sale-success-chime.wav.asset.json";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useAlertPrefs } from "@/components/AlertPrefsSection";
import { SaleWinModal, type SaleWinPayload } from "@/components/SaleWinModal";

let chimeAudio: HTMLAudioElement | null = null;

function playChime() {
  try {
    if (!chimeAudio) {
      chimeAudio = new Audio(chimeAsset.url);
      chimeAudio.preload = "auto";
    }
    chimeAudio.currentTime = 0;
    chimeAudio.play().catch(() => {});
  } catch {
    // ignore
  }
}

type SaleEvent = {
  id: string;
  agent_name: string | null;
  agent_avatar_url: string | null;
  lead_name: string | null;
  premium: number | null;
  side: "auto" | "home" | "motorcycle" | "boat" | "umbrella" | "flood" | "golf_cart";
  items_count: number | null;
  created_at: string;
  lead_id?: string | null;
  lead_table?: string | null;
};

export function SaleAlertsListener() {
  const { user } = useAuth();
  const { data: prefs } = useAlertPrefs();
  const seenRef = useRef<Set<string>>(new Set());
  const [activeSale, setActiveSale] = useState<SaleWinPayload | null>(null);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("sale_events_feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sale_events" },
        async (payload) => {
          const evt = payload.new as SaleEvent;
          if (!evt?.id || seenRef.current.has(evt.id)) return;
          seenRef.current.add(evt.id);

          // Respect user preferences (default to on if not loaded yet).
          const showToast = prefs?.sale_toast ?? true;
          const playSound = prefs?.sale_sound ?? true;
          if (!showToast && !playSound) return;

          // Pre-sign + preload the headshot so the modal opens with the
          // image already cached — avoids the initials → photo flash.
          let signedAvatar: string | null = null;
          if (evt.agent_avatar_url) {
            try {
              const { data } = await supabase.storage
                .from("avatars")
                .createSignedUrl(evt.agent_avatar_url, 60 * 60);
              if (data?.signedUrl) {
                signedAvatar = data.signedUrl;
                await new Promise<void>((resolve) => {
                  const img = new Image();
                  img.onload = () => resolve();
                  img.onerror = () => resolve();
                  img.src = data.signedUrl;
                  // Hard cap so a slow image never blocks the alert.
                  setTimeout(() => resolve(), 1500);
                });
              }
            } catch {
              // ignore — fall back to initials placeholder
            }
          }

          if (playSound) playChime();
          if (showToast) {
            // Tally today's sales (ET) including the one that just fired.
            let todaySales: number | null = null;
            let todayPremium: number | null = null;
            let todayLeaderboard: Array<{
              agent_name: string | null;
              sales: number;
              premium: number;
              avatar_url: string | null;
            }> = [];
            let yesterdayPremium: number | null = null;
            let teamGoalPremium: number | null = null;
            try {
              const etMidnight = new Date(
                new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
              );
              etMidnight.setHours(0, 0, 0, 0);
              const { data: rows } = await supabase
                .from("sale_events")
                .select("premium, agent_name, agent_avatar_url")
                .gte("created_at", etMidnight.toISOString());
              if (rows) {
                todaySales = rows.length;
                todayPremium = rows.reduce(
                  (sum, r: any) => sum + (Number(r.premium) || 0),
                  0,
                );
                const byAgent = new Map<
                  string,
                  { agent_name: string | null; sales: number; premium: number; avatar_url: string | null }
                >();
                for (const r of rows as any[]) {
                  const key = (r.agent_name || "Unknown").trim();
                  const cur = byAgent.get(key) ?? {
                    agent_name: r.agent_name ?? null,
                    sales: 0,
                    premium: 0,
                    avatar_url: r.agent_avatar_url ?? null,
                  };
                  cur.sales += 1;
                  cur.premium += Number(r.premium) || 0;
                  if (!cur.avatar_url && r.agent_avatar_url) cur.avatar_url = r.agent_avatar_url;
                  byAgent.set(key, cur);
                }
                todayLeaderboard = Array.from(byAgent.values())
                  .sort((a, b) => b.premium - a.premium)
                  .slice(0, 5);
              }

              // Yesterday's premium total (previous ET day)
              try {
                const yStart = new Date(etMidnight.getTime() - 24 * 60 * 60 * 1000);
                const { data: yRows } = await supabase
                  .from("sale_events")
                  .select("premium")
                  .gte("created_at", yStart.toISOString())
                  .lt("created_at", etMidnight.toISOString());
                yesterdayPremium = (yRows ?? []).reduce(
                  (s, r: any) => s + (Number(r.premium) || 0),
                  0,
                );
              } catch { /* non-fatal */ }

              // Team goal (agency premium)
              try {
                const { data: goalRows } = await supabase
                  .from("goals")
                  .select("period, target")
                  .eq("scope", "agency")
                  .eq("metric", "premium");
                const byPeriod = new Map<string, number>();
                for (const g of (goalRows ?? []) as any[]) {
                  byPeriod.set(g.period, Number(g.target) || 0);
                }
                if (byPeriod.get("daily")) teamGoalPremium = byPeriod.get("daily")!;
                else if (byPeriod.get("weekly"))
                  teamGoalPremium = Math.round(byPeriod.get("weekly")! / 5);
                else if (byPeriod.get("monthly"))
                  teamGoalPremium = Math.round(byPeriod.get("monthly")! / 22);
              } catch { /* non-fatal */ }
            } catch {
              // non-fatal — modal still shows without the strip
            }
            setActiveSale({
              id: evt.id,
              agent_name: evt.agent_name,
              agent_avatar_url: evt.agent_avatar_url ?? null,
              agent_avatar_signed_url: signedAvatar,
              lead_name: evt.lead_name,
              premium: evt.premium != null ? Number(evt.premium) : null,
              side: evt.side,
              items_count: evt.items_count != null ? Number(evt.items_count) : null,
              lead_id: evt.lead_id ?? null,
              lead_table: evt.lead_table ?? null,
              today_sales: todaySales,
              today_premium: todayPremium,
              today_leaderboard: todayLeaderboard,
              team_goal_premium: teamGoalPremium,
              yesterday_premium: yesterdayPremium,
            });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, prefs?.sale_toast, prefs?.sale_sound]);

  return (
    <SaleWinModal
      event={activeSale}
      open={!!activeSale}
      onClose={() => setActiveSale(null)}
    />
  );
}

export default SaleAlertsListener;