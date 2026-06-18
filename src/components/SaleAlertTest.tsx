import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bell, Mail, Volume2, Eye, Play, Send } from "lucide-react";
import { SaleWinModal, type SaleWinPayload } from "@/components/SaleWinModal";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { template as saleLeaderboardTemplate } from "@/lib/email-templates/sale-leaderboard";

const fmtMoney = (n: number | null | undefined) =>
  typeof n === "number" && !Number.isNaN(n)
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    : "—";

function playDing() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const playTone = (freq: number, when: number, dur = 0.18) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      o.type = "sine";
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0, ctx.currentTime + when);
      g.gain.linearRampToValueAtTime(0.25, ctx.currentTime + when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
      o.start(ctx.currentTime + when);
      o.stop(ctx.currentTime + when + dur + 0.02);
    };
    playTone(880, 0);
    playTone(1175, 0.15);
    playTone(1568, 0.3, 0.3);
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {
    // ignore
  }
}

const fallbackSale: SaleWinPayload = {
  id: "demo",
  agent_name: "Your top closer",
  lead_name: "Sample Lead",
  premium: 2184,
  side: "auto",
  lead_id: null,
  lead_table: null,
  today_sales: 1,
  today_premium: 2184,
  today_leaderboard: [],
};

async function buildLiveDemoSale(): Promise<SaleWinPayload> {
  try {
    const etMidnight = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
    );
    etMidnight.setHours(0, 0, 0, 0);
    // Today's rows first; if empty, fall back to most recent 25.
    let { data: rows } = await supabase
      .from("sale_events")
      .select("id, agent_name, agent_avatar_url, lead_name, premium, side, items_count, created_at")
      .gte("created_at", etMidnight.toISOString())
      .order("created_at", { ascending: false });
    if (!rows || rows.length === 0) {
      const r = await supabase
        .from("sale_events")
        .select("id, agent_name, agent_avatar_url, lead_name, premium, side, items_count, created_at")
        .order("created_at", { ascending: false })
        .limit(25);
      rows = r.data ?? [];
    }
    if (!rows || rows.length === 0) return fallbackSale;

    const headline: any = rows[0];
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
    const leaderboard = Array.from(byAgent.values())
      .sort((a, b) => b.premium - a.premium)
      .slice(0, 5);
    const todaySales = rows.length;
    const todayPremium = rows.reduce((s, r: any) => s + (Number(r.premium) || 0), 0);

    return {
      id: `demo-${headline.id}`,
      agent_name: headline.agent_name ?? "An agent",
      agent_avatar_url: headline.agent_avatar_url ?? null,
      lead_name: headline.lead_name ?? "Sample Lead",
      premium: headline.premium != null ? Number(headline.premium) : null,
      side: (headline.side ?? "auto") as SaleWinPayload["side"],
      items_count: headline.items_count != null ? Number(headline.items_count) : 1,
      lead_id: null,
      lead_table: null,
      today_sales: todaySales,
      today_premium: todayPremium,
      today_leaderboard: leaderboard,
    };
  } catch {
    return fallbackSale;
  }
}

export function SaleAlertTest() {
  const [demoSale, setDemoSale] = useState<SaleWinPayload | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);

  async function showDemo(withSound: boolean) {
    setLoadingDemo(true);
    try {
      const sale = await buildLiveDemoSale();
      if (withSound) playDing();
      setDemoSale(sale);
    } finally {
      setLoadingDemo(false);
    }
  }

  async function sendTestEmail() {
    if (!testEmail) {
      toast.error("Enter a recipient email");
      return;
    }
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in");
      const res = await fetch("/lovable/email/transactional/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          templateName: "sale-leaderboard",
          recipientEmail: testEmail,
          idempotencyKey: `sale-leaderboard-test-${Date.now()}`,
          templateData: saleLeaderboardTemplate.previewData ?? {},
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Send failed (${res.status})`);
      }
      toast.success(`Test email queued to ${testEmail}`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to send test email");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Play className="w-4 h-4" />
            Test on-screen alert
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Click the button below to simulate a new sale. This is exactly what every logged-in user will see and hear.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => showDemo(true)} disabled={loadingDemo}>
              <Bell className="w-4 h-4 mr-2" />
              Show alert + sound
            </Button>
            <Button variant="outline" onClick={() => showDemo(false)} disabled={loadingDemo}>
              <Eye className="w-4 h-4 mr-2" />
              Alert only (no sound)
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                playDing();
              }}
            >
              <Volume2 className="w-4 h-4 mr-2" />
              Sound only
            </Button>
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-2">
            <span className="flex items-center gap-1">
              <Bell className="w-3 h-3" /> Celebration modal appears center-screen
            </span>
            <span className="flex items-center gap-1">
              <Volume2 className="w-3 h-3" /> 3-note chime plays
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Mail className="w-4 h-4" />
            Email preview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            This is the leaderboard email sent instantly to every admin and sales agent when a sale is recorded.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end mb-4 p-4 rounded-lg border bg-muted/40">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="test-email" className="text-xs">Send test to</Label>
              <Input
                id="test-email"
                type="email"
                placeholder="you@example.com"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
              />
            </div>
            <Button onClick={sendTestEmail} disabled={sending}>
              <Send className="w-4 h-4 mr-2" />
              {sending ? "Sending…" : "Send test email"}
            </Button>
          </div>
          <div className="rounded-lg border bg-white">
            <EmailPreview />
          </div>
        </CardContent>
      </Card>

      <SaleWinModal
        event={demoSale}
        open={!!demoSale}
        onClose={() => setDemoSale(null)}
      />
    </div>
  );
}

function EmailPreview() {
  const data = saleLeaderboardTemplate.previewData;
  if (!data) return <p className="p-4 text-sm text-muted-foreground">No preview data available.</p>;

  const leaderboard = (data.leaderboard as any[]) || [];

  return (
    <div className="p-6" style={{ fontFamily: "Arial, sans-serif", color: "#334155" }}>
      <h1 style={{ fontSize: "22px", fontWeight: "bold", color: "#0f172a", margin: "0 0 16px" }}>
        New sale closed
      </h1>
      <p style={{ fontSize: "14px", lineHeight: "1.5", margin: "0 0 16px" }}>
        <strong>{String(data.agentName || "An agent")}</strong> just closed{" "}
        <strong>{String(data.leadName || "a lead")}</strong>
        {data.side ? ` (${String(data.side)})` : ""} for <strong>{fmtMoney(data.premium as number)}</strong>.
      </p>

      <div
        className="rounded-lg p-4 mb-5"
        style={{ backgroundColor: "#ecfdf5", border: "1px solid #a7f3d0" }}
      >
        <p style={{ fontSize: "14px", color: "#065f46", margin: "0 0 6px" }}>
          <strong>Sales today:</strong> {data.totalSales}
        </p>
        <p style={{ fontSize: "14px", color: "#065f46", margin: "0 0 6px" }}>
          <strong>Premium today:</strong> {fmtMoney(data.totalPremium as number)}
        </p>
        {data.dateLabel ? (
          <p style={{ fontSize: "12px", color: "#047857", margin: "6px 0 0" }}>{data.dateLabel}</p>
        ) : null}
      </div>

      <h2 style={{ fontSize: "16px", fontWeight: "bold", color: "#0f172a", margin: "20px 0 10px" }}>
        Today&apos;s leaderboard
      </h2>
      <div
        className="rounded-lg p-3 mb-5"
        style={{ backgroundColor: "#f8fafc", border: "1px solid #e2e8f0" }}
      >
        {leaderboard.length === 0 ? (
          <p style={{ fontSize: "14px", margin: "0 0 16px" }}>No sales recorded yet today.</p>
        ) : (
          leaderboard.map((row: any, i: number) => (
            <p
              key={`${row.agent_name}-${i}`}
              style={{ fontSize: "14px", color: "#0f172a", margin: "0 0 6px" }}
            >
              <span style={{ display: "inline-block", minWidth: "28px", color: "#64748b" }}>
                #{i + 1}
              </span>{" "}
              <strong>{row.agent_name}</strong> — {row.sales} sale
              {row.sales === 1 ? "" : "s"} · {fmtMoney(row.premium)}
            </p>
          ))
        )}
      </div>

      <p style={{ fontSize: "12px", color: "#94a3b8", margin: "24px 0 0" }}>— Jet Leads</p>
    </div>
  );
}
