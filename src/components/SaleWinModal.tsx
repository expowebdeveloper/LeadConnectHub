import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Trophy, TrendingUp, Target } from "lucide-react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { useEffect, useState } from "react";

export type SaleWinPayload = {
  id: string;
  agent_name: string | null;
  agent_avatar_url?: string | null;
  agent_avatar_signed_url?: string | null;
  lead_name: string | null;
  premium: number | null;
  side: "auto" | "home" | "motorcycle" | "boat" | "umbrella" | "flood" | "golf_cart" | "rv";
  items_count?: number | null;
  lead_id?: string | null;
  lead_table?: string | null;
  source?: string | null;
  today_sales?: number | null;
  today_premium?: number | null;
  team_goal_premium?: number | null;
  yesterday_premium?: number | null;
  today_leaderboard?: Array<{
    agent_name: string | null;
    sales: number;
    premium: number;
    avatar_url?: string | null;
    avatar_signed_url?: string | null;
  }> | null;
};

const fmtMoney = (n: number | null | undefined) =>
  typeof n === "number" && !Number.isNaN(n)
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    : "—";

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || "An agent";

const policyLabel = (side: SaleWinPayload["side"]) => {
  switch (side) {
    case "home": return "Home";
    case "motorcycle": return "Motorcycle";
    case "boat": return "Boat";
    case "umbrella": return "Umbrella";
    case "flood": return "Flood";
    case "golf_cart": return "Golf Cart";
    case "rv": return "RV";
    default: return "Auto";
  }
};

const itemsLabel = (side: SaleWinPayload["side"], n: number) => {
  if (side === "auto") return `${n} ${n === 1 ? "vehicle" : "vehicles"}`;
  if (side === "home") return `${n} ${n === 1 ? "dwelling" : "dwellings"}`;
  if (side === "boat") return `${n} ${n === 1 ? "boat" : "boats"}`;
  if (side === "motorcycle") return `${n} ${n === 1 ? "motorcycle" : "motorcycles"}`;
  if (side === "golf_cart") return `${n} ${n === 1 ? "golf cart" : "golf carts"}`;
  if (side === "rv") return `${n} ${n === 1 ? "RV" : "RVs"}`;
  return `${n} ${n === 1 ? "item" : "items"}`;
};

const policyEmoji = (side: SaleWinPayload["side"]) => {
  switch (side) {
    case "home": return "🏠";
    case "motorcycle": return "🏍️";
    case "boat": return "⛵";
    case "umbrella": return "☂️";
    case "flood": return "🌊";
    case "golf_cart": return "🏌️";
    case "rv": return "🚐";
    default: return "🚗";
  }
};

const itemUnitLabel = (side: SaleWinPayload["side"], n: number) => {
  if (side === "auto") return n === 1 ? "VEHICLE" : "VEHICLES";
  if (side === "home") return n === 1 ? "DWELLING" : "DWELLINGS";
  if (side === "boat") return n === 1 ? "BOAT" : "BOATS";
  if (side === "motorcycle") return n === 1 ? "MOTORCYCLE" : "MOTORCYCLES";
  if (side === "golf_cart") return n === 1 ? "GOLF CART" : "GOLF CARTS";
  if (side === "rv") return n === 1 ? "RV" : "RVs";
  if (side === "umbrella") return n === 1 ? "POLICY" : "POLICIES";
  if (side === "flood") return n === 1 ? "POLICY" : "POLICIES";
  return n === 1 ? "ITEM" : "ITEMS";
};
void itemsLabel;

function GreenConfetti() {
  const bits = [
    { left: "8%", top: "12%", bg: "#3DFF63", r: "-12deg" },
    { left: "22%", top: "4%", bg: "#28C840", r: "20deg" },
    { left: "38%", top: "16%", bg: "#3DFF63", r: "8deg" },
    { left: "54%", top: "6%", bg: "#28C840", r: "-25deg" },
    { left: "70%", top: "14%", bg: "#3DFF63", r: "15deg" },
    { left: "86%", top: "8%", bg: "#28C840", r: "-10deg" },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {bits.map((b, i) => (
        <span
          key={i}
          className="absolute w-1.5 h-3 rounded-sm opacity-70"
          style={{ left: b.left, top: b.top, background: b.bg, transform: `rotate(${b.r})`, boxShadow: `0 0 8px ${b.bg}` }}
        />
      ))}
    </div>
  );
}

function useCountUp(target: number, durationMs = 800) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

export function SaleWinModal({
  event,
  open,
  onClose,
}: {
  event: SaleWinPayload | null;
  open: boolean;
  onClose: () => void;
}) {
  const premiumValue = event?.premium ?? 0;
  const animPremium = useCountUp(open && event ? premiumValue : 0, 800);
  const goal =
    typeof event?.team_goal_premium === "number" && event.team_goal_premium > 0
      ? event.team_goal_premium
      : 250000;
  const goalPctTarget = Math.max(
    0,
    Math.min(100, Math.round(((event?.today_premium ?? 0) / goal) * 100)),
  );
  const [goalPct, setGoalPct] = useState(0);
  useEffect(() => {
    if (!open) {
      setGoalPct(0);
      return;
    }
    const id = window.setTimeout(() => setGoalPct(goalPctTarget), 80);
    return () => window.clearTimeout(id);
  }, [open, goalPctTarget]);

  if (!event) return null;

  const closerName = event.agent_name?.trim() || "An agent";
  const closerFirst = firstName(event.agent_name);
  const policyType = policyLabel(event.side);
  const items = event.items_count && event.items_count > 0 ? event.items_count : 1;
  const leaderboard = (event.today_leaderboard ?? []).slice(0, 3);
  const meIdx = leaderboard.findIndex(
    (r) => (r.agent_name || "").trim().toLowerCase() === closerName.toLowerCase(),
  );
  const meRank = meIdx >= 0 ? meIdx + 1 : null;
  const yesterday = typeof event.yesterday_premium === "number" ? event.yesterday_premium : null;
  const needToBeat = yesterday != null ? Math.max(0, yesterday - (event.today_premium ?? 0)) : null;
  const aheadOfYesterday = yesterday != null && (event.today_premium ?? 0) > yesterday;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-md p-0 overflow-hidden border-0 max-h-[92vh] flex flex-col text-white"
        style={{
          background: "linear-gradient(180deg, #06120A 0%, #081A0D 50%, #0B2212 100%)",
          border: "1px solid rgba(61,255,99,0.25)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.55), 0 0 60px rgba(61,255,99,0.10)",
        }}
      >
        <style>{`
          @keyframes salePulse {
            0%, 100% { box-shadow: 0 0 0 6px rgba(61,255,99,0.18), 0 8px 30px rgba(61,255,99,0.35); }
            50%      { box-shadow: 0 0 0 10px rgba(61,255,99,0.28), 0 8px 40px rgba(61,255,99,0.55); }
          }
          .sale-glow { animation: salePulse 2s ease-in-out infinite; }
          .sale-progress-fill { transition: width 1s cubic-bezier(.2,.7,.2,1); }
          .sale-lb-row { transition: background-color .15s ease; }
          .sale-lb-row:hover { background-color: rgba(61,255,99,0.08); }
        `}</style>

        {/* Header */}
        <div className="relative px-5 pt-5 pb-3 shrink-0">
          <GreenConfetti />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold tracking-wide">
              <span style={{ color: "#3DFF63" }}>◆</span>
              <span className="text-white">LeadVault</span>
            </div>
            <span
              className="text-[10px] font-bold tracking-[0.12em] px-2.5 py-1 rounded-full"
              style={{
                color: "#3DFF63",
                background: "rgba(61,255,99,0.10)",
                border: "1px solid rgba(61,255,99,0.30)",
              }}
            >
              🔔 SALES ALERT
            </span>
          </div>
          <div
            className="mt-3 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(61,255,99,0.35), transparent)",
            }}
          />
        </div>

        <div className="px-5 pb-5 overflow-y-auto">
          {/* Hero */}
          <div className="flex flex-col items-center text-center pt-2">
            <div
              className="rounded-full sale-glow"
              style={{ border: "3px solid #3DFF63", padding: 0 }}
            >
              <AgentAvatar
                size="xl"
                name={event.agent_name}
                path={event.agent_avatar_url}
                signedUrl={event.agent_avatar_signed_url}
                className="h-20 w-20 text-2xl"
              />
            </div>
            <h2 className="mt-4 text-xl font-extrabold tracking-wide text-white">
              🔥 {closerFirst.toUpperCase()} CLOSED ONE!
            </h2>
          </div>

          {/* Policy Badge Bar */}
          <div
            className="mt-4 flex items-center justify-between gap-3 rounded-2xl px-3 py-3"
            style={{
              background: "rgba(61,255,99,0.05)",
              border: "1px solid rgba(61,255,99,0.25)",
              boxShadow: "0 0 24px rgba(61,255,99,0.10)",
            }}
          >
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-extrabold tracking-[0.10em]"
              style={{
                color: "#3DFF63",
                background: "rgba(61,255,99,0.10)",
                border: "1px solid rgba(61,255,99,0.45)",
                boxShadow: "0 0 12px rgba(61,255,99,0.30)",
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>{policyEmoji(event.side)}</span>
              {policyType.toUpperCase()}
            </span>
            <span
              className="flex-1 text-center font-extrabold tabular-nums text-white"
              style={{ fontSize: 20, letterSpacing: "0.06em" }}
            >
              ×{items} <span style={{ color: "#D1D5DB", fontSize: 14, letterSpacing: "0.12em" }}>{itemUnitLabel(event.side, items)}</span>
            </span>
            {event.source ? (
              <span
                className="rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.10em]"
                style={{
                  color: "#9CA3AF",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {event.source.toUpperCase()}
              </span>
            ) : (
              <span style={{ width: 1 }} />
            )}
          </div>

          {/* Premium */}
          <div className="text-center pt-3 pb-4">
            <div
              className="font-extrabold tabular-nums"
              style={{
                color: "#3DFF63",
                fontSize: 52,
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
                textShadow: "0 0 24px rgba(61,255,99,0.45)",
              }}
            >
              {fmtMoney(Math.round(animPremium))}
            </div>
            <div
              className="text-[10px] font-bold tracking-[0.24em] mt-0.5"
              style={{ color: "#9CA3AF" }}
            >
              PREMIUM
            </div>
            <div className="mt-2 text-xs" style={{ color: "#D1D5DB" }}>
              Closed by <span className="font-semibold text-white">{closerName}</span>
            </div>
          </div>

          {/* Achievement */}
          <div
            className="rounded-2xl text-center px-4 py-4 mb-3"
            style={{
              background: "rgba(61,255,99,0.06)",
              border: "1px solid rgba(61,255,99,0.25)",
              boxShadow: "0 0 24px rgba(61,255,99,0.10)",
            }}
          >
            <Trophy
              className="mx-auto mb-1"
              style={{ color: "#3DFF63", filter: "drop-shadow(0 0 8px rgba(61,255,99,0.6))" }}
            />
            <div
              className="text-lg font-extrabold tracking-[0.06em]"
              style={{ color: "#3DFF63" }}
            >
              {meRank === 1 ? "#1 TODAY" : meRank ? `#${meRank} TODAY` : "ON THE BOARD"}
            </div>
            <div className="text-xs mt-0.5" style={{ color: "#D1D5DB" }}>
              {meRank === 1
                ? "Way to lead the team!"
                : meRank
                  ? "Keep climbing."
                  : "Welcome to the board."}
            </div>
          </div>

          {/* Team Goal */}
          <div
            className="rounded-2xl px-4 py-3.5 mb-3"
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(61,255,99,0.18)",
            }}
          >
            <div className="flex items-center justify-between">
              <span
                className="text-[10px] font-bold tracking-[0.18em] flex items-center gap-1.5"
                style={{ color: "#9CA3AF" }}
              >
                <Target className="w-3 h-3" /> DAILY TEAM GOAL
              </span>
              <span className="text-sm font-bold" style={{ color: "#3DFF63" }}>
                {goalPctTarget}%
              </span>
            </div>
            <div className="mt-2 mb-2.5 text-base font-bold tabular-nums">
              <span style={{ color: "#3DFF63" }}>{fmtMoney(event.today_premium ?? 0)}</span>
              <span style={{ color: "#9CA3AF" }}> / {fmtMoney(goal)}</span>
            </div>
            <div
              className="h-2.5 w-full rounded-full overflow-hidden"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(61,255,99,0.15)",
              }}
            >
              <div
                className="sale-progress-fill h-full rounded-full"
                style={{
                  width: `${goalPct}%`,
                  background: "linear-gradient(90deg, #28C840, #3DFF63)",
                  boxShadow: "0 0 14px rgba(61,255,99,0.55)",
                }}
              />
            </div>
          </div>

          {/* Leaderboard */}
          {leaderboard.length > 0 && (
            <div
              className="rounded-2xl px-4 py-3 mb-3"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(61,255,99,0.18)",
              }}
            >
              <div
                className="text-[10px] font-bold tracking-[0.18em] mb-2"
                style={{ color: "#9CA3AF" }}
              >
                LEADERBOARD
              </div>
              <div className="divide-y" style={{ borderColor: "rgba(61,255,99,0.08)" }}>
                {leaderboard.map((row, i) => {
                  const isCurrent =
                    !!event.agent_name &&
                    row.agent_name?.trim().toLowerCase() ===
                      event.agent_name.trim().toLowerCase();
                  const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
                  return (
                    <div
                      key={`${row.agent_name}-${i}`}
                      className="sale-lb-row flex items-center gap-2.5 py-2 px-2 rounded-md"
                      style={isCurrent ? { background: "rgba(61,255,99,0.10)" } : undefined}
                    >
                      <span className="text-lg w-6 text-center">{medal}</span>
                      <AgentAvatar
                        size="sm"
                        name={row.agent_name}
                        path={row.avatar_url ?? null}
                        signedUrl={row.avatar_signed_url ?? null}
                      />
                      <span className="flex-1 truncate font-semibold text-white text-sm">
                        {row.agent_name || "Unknown"}
                      </span>
                      <span
                        className="text-sm font-bold tabular-nums"
                        style={{ color: "#3DFF63" }}
                      >
                        {fmtMoney(row.premium)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Beat yesterday */}
          {yesterday != null && !aheadOfYesterday && (
            <div
              className="rounded-2xl text-center px-4 py-4"
              style={{
                background:
                  "linear-gradient(180deg, rgba(61,255,99,0.10), rgba(40,200,64,0.04))",
                border: "1px solid rgba(61,255,99,0.30)",
                boxShadow: "0 0 28px rgba(61,255,99,0.15)",
              }}
            >
              <TrendingUp
                className="mx-auto mb-1"
                style={{ color: "#3DFF63", filter: "drop-shadow(0 0 8px rgba(61,255,99,0.6))" }}
              />
              <div
                className="text-base font-extrabold tracking-[0.08em] text-white"
              >
                LET'S BEAT YESTERDAY!
              </div>
              <div className="text-xs mt-1" style={{ color: "#D1D5DB" }}>
                We need
              </div>
              <div
                className="font-extrabold tabular-nums"
                style={{
                  color: "#3DFF63",
                  fontSize: 32,
                  textShadow: "0 0 20px rgba(61,255,99,0.45)",
                }}
              >
                {fmtMoney(needToBeat)}
              </div>
              <div className="text-xs" style={{ color: "#D1D5DB" }}>
                to beat yesterday's total.
              </div>
            </div>
          )}
          {yesterday != null && aheadOfYesterday && (
            <div
              className="rounded-2xl text-center px-4 py-4"
              style={{
                background:
                  "linear-gradient(180deg, rgba(61,255,99,0.10), rgba(40,200,64,0.04))",
                border: "1px solid rgba(61,255,99,0.30)",
                boxShadow: "0 0 28px rgba(61,255,99,0.15)",
              }}
            >
              <div className="text-2xl">🚀</div>
              <div className="text-base font-extrabold tracking-[0.08em] text-white">
                AHEAD OF YESTERDAY
              </div>
              <div className="text-xs mt-1" style={{ color: "#D1D5DB" }}>
                Keep the streak going.
              </div>
            </div>
          )}

          {/* Footer */}
          <div
            className="mt-4 pt-3 flex items-center justify-between text-[11px]"
            style={{ borderTop: "1px solid rgba(61,255,99,0.15)" }}
          >
            <div>
              <div className="font-bold text-white">◆ LeadVault</div>
              <div style={{ color: "#9CA3AF" }}>Anchor more policies. Win as a team.</div>
            </div>
            <div className="text-right" style={{ color: "#D1D5DB" }}>
              <div>🎯 Focus Forward</div>
              <div>👥 Team First</div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SaleWinModal;