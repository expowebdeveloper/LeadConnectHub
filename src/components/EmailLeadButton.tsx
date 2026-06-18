import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

type Vehicle = { year: string | number | null; make: string | null; model: string | null };

interface EmailLeadButtonProps {
  email: string | null | undefined;
  /** Lead id used to log the email-send activity. Optional but required for activity scoring. */
  leadId?: string | null;
  /** Which lead table the id belongs to. */
  leadTable?: "leads" | "list_leads" | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  carrier?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  quotedPremium?: number | null;
  currentPremium?: number | null;
  vehicles?: Vehicle[] | null;
  vendorNotes?: string | null;
  className?: string;
  stopPropagation?: boolean;
  children?: React.ReactNode;
}

type TemplateCtx = {
  firstName: string;
  agentName: string;
  agentPhone?: string | null;
  carrier?: string | null;
  city?: string | null;
  state?: string | null;
  quotedPremium?: number | null;
  currentPremium?: number | null;
  vehicles?: Vehicle[] | null;
};

type EmailTemplate = {
  id: string;
  label: string;
  description: string;
  subject: (c: TemplateCtx) => string;
  body: (c: TemplateCtx) => string;
};

const sign = (agent: string, phone?: string | null) =>
  `\n\nThanks,\n${agent}${phone ? `\n${phone}` : ""}`;

const vehiclesLine = (v?: Vehicle[] | null) => {
  if (!v || v.length === 0) return "";
  const list = v
    .map((x) => [x.year, x.make, x.model].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(", ");
  return list ? ` for your ${list}` : "";
};

const savings = (c: TemplateCtx) => {
  if (c.currentPremium != null && c.quotedPremium != null) {
    const diff = c.currentPremium - c.quotedPremium;
    if (diff > 0) return ` around $${Math.round(diff).toLocaleString()}`;
  }
  return "";
};

const TEMPLATES: EmailTemplate[] = [
  {
    id: "intro",
    label: "Intro / First Touch",
    description: "Introduce yourself after a new lead or assignment.",
    subject: (c) => `Quick intro${c.firstName ? `, ${c.firstName}` : ""}`,
    body: (c) =>
      `Hi ${c.firstName},\n\nThanks for the interest in a quote${vehiclesLine(c.vehicles)}. I'm ${c.agentName} and I'll be helping you personally.${c.agentPhone ? ` You can reach me directly at ${c.agentPhone}.` : ""}\n\nWhen is a good 5-minute window today to go over a couple of quick details so I can put together your best options? You can also just reply with a time that works.` +
      sign(c.agentName, c.agentPhone),
  },
  {
    id: "info-needed",
    label: "Quote Started / Info Needed",
    description: "You started the quote and need a few details.",
    subject: (c) => `Almost done with your quote${c.firstName ? `, ${c.firstName}` : ""}`,
    body: (c) =>
      `Hi ${c.firstName},\n\nGood news — I've already started your quote${vehiclesLine(c.vehicles)} and I'm close to having numbers for you. I just need a couple of quick details to finalize it.\n\nWhat's the best number and time to reach you today?${c.agentPhone ? ` Or call me directly at ${c.agentPhone}.` : ""} It usually takes under 5 minutes.` +
      sign(c.agentName, c.agentPhone),
  },
  {
    id: "quote-ready",
    label: "Quote Ready",
    description: "Push to a phone call to walk through the quote.",
    subject: (c) => `Your quote is ready${c.firstName ? `, ${c.firstName}` : ""}`,
    body: (c) =>
      `Hi ${c.firstName},\n\nYour quote is ready. I'd rather walk you through it for 3–4 minutes than just send numbers — that way you see exactly what's covered and where you save.\n\nDoes later today or tomorrow morning work better for a quick call?${c.agentPhone ? ` My direct line is ${c.agentPhone}.` : ""}` +
      sign(c.agentName, c.agentPhone),
  },
  {
    id: "savings",
    label: "Savings Opportunity",
    description: "Possible savings vs. current premium.",
    subject: (c) => `Possible savings on your ${c.carrier ?? "current"} policy`,
    body: (c) =>
      `Hi ${c.firstName},\n\nBased on what you shared${c.carrier ? ` about your ${c.carrier} policy` : ""}, it looks like there may be room to save${savings(c)} without giving up coverage.\n\nI'd like to confirm the numbers with you on a quick call. What's a good time today?${c.agentPhone ? ` Feel free to call me at ${c.agentPhone}.` : ""}` +
      sign(c.agentName, c.agentPhone),
  },
  {
    id: "coverage-review",
    label: "Coverage Review",
    description: "Reframe around protection, not just price.",
    subject: (c) => `A quick coverage check${c.firstName ? `, ${c.firstName}` : ""}`,
    body: (c) =>
      `Hi ${c.firstName},\n\nBefore we land on a final number, I want to make sure your coverage actually protects what matters — most people are surprised by what their current policy doesn't cover.\n\nCan I grab 5 minutes to walk through it with you? It's the part most agents skip.${c.agentPhone ? ` My direct line is ${c.agentPhone}.` : ""}` +
      sign(c.agentName, c.agentPhone),
  },
  {
    id: "follow-up",
    label: "Follow-Up",
    description: "After no answer or no response.",
    subject: (c) => `Following up${c.firstName ? `, ${c.firstName}` : ""}`,
    body: (c) =>
      `Hi ${c.firstName},\n\nJust circling back on your quote. I don't want to keep bugging you — a quick "good time" or "not now" reply is all I need and I'll work around your schedule.${c.agentPhone ? ` Or call me directly at ${c.agentPhone}.` : ""}` +
      sign(c.agentName, c.agentPhone),
  },
  {
    id: "missed-call",
    label: "Missed Call",
    description: "Pair a call attempt with written follow-up.",
    subject: (c) => `Sorry I missed you${c.firstName ? `, ${c.firstName}` : ""}`,
    body: (c) =>
      `Hi ${c.firstName},\n\nI tried you a moment ago about your quote and didn't want to leave you hanging. Just reply with a time that works and I'll call right then${c.agentPhone ? `, or call me back at ${c.agentPhone}` : ""} — most of my clients wrap this up in under 10 minutes.` +
      sign(c.agentName, c.agentPhone),
  },
  {
    id: "appt-confirm",
    label: "Appointment Confirmation",
    description: "Confirm a set call time.",
    subject: () => `Confirming our call`,
    body: (c) =>
      `Hi ${c.firstName},\n\nConfirming our call — I'll reach out at the time we set${c.agentPhone ? ` from ${c.agentPhone}` : ""}. Please have your current declarations page or policy handy if you can; it makes the comparison much faster.\n\nIf anything changes, just reply here${c.agentPhone ? ` or call me at ${c.agentPhone}` : ""}.` +
      sign(c.agentName, c.agentPhone),
  },
  {
    id: "requote",
    label: "Requote / Renewal",
    description: "Older lead or near renewal.",
    subject: (c) => `Worth a second look${c.firstName ? `, ${c.firstName}` : ""}?`,
    body: (c) =>
      `Hi ${c.firstName},\n\nRates have shifted a lot recently and I wanted to circle back. With where things stand now, there's a real chance I can do better than what you have${c.carrier ? ` with ${c.carrier}` : ""}.\n\nWorth a 5-minute look? I just need your renewal date and current premium to start.` +
      sign(c.agentName, c.agentPhone),
  },
  {
    id: "aged-lead",
    label: "Aged Lead / Requote",
    description: "Re-engage a lead that went cold or is past its original quote window.",
    subject: (c) => `Still shopping${c.firstName ? `, ${c.firstName}` : ""}?`,
    body: (c) =>
      `Hi ${c.firstName},\n\nI know it's been a while since we last talked. Since then, rates and options have changed — I just ran a fresh comparison and there's a real opportunity to save${vehiclesLine(c.vehicles)}.\n\nIf you're still in the market, a 5-minute call is all it takes. If not, just reply "not now" and I won't keep reaching out.` +
      sign(c.agentName, c.agentPhone),
  },
  {
    id: "objection",
    label: "Objection Follow-Up",
    description: "After resistance or 'send me the quote'.",
    subject: (c) => `Got it${c.firstName ? `, ${c.firstName}` : ""} — here's the honest answer`,
    body: (c) =>
      `Hi ${c.firstName},\n\nTotally understand. I can email numbers, but every time I've done that without a 3-minute walk-through, people either compare the wrong things or overpay.\n\nIf you give me a quick window, I'll show you exactly what's different and you decide from there — zero pressure.` +
      sign(c.agentName, c.agentPhone),
  },
  {
    id: "doc-request",
    label: "Document Request",
    description: "Need documents to complete the quote.",
    subject: () => `Quick docs to finish your quote`,
    body: (c) =>
      `Hi ${c.firstName},\n\nTo finalize your quote I just need:\n  • Current declarations page (or photos of it)\n  • Driver's license\n  • Vehicle info if anything changed\n\nYou can reply with photos right from your phone — easiest way.` +
      sign(c.agentName, c.agentPhone),
  },
  {
    id: "application",
    label: "Application / Signature",
    description: "Ready to move forward — get it signed.",
    subject: () => `Ready to sign — last step`,
    body: (c) =>
      `Hi ${c.firstName},\n\nGreat news — everything is set up on my end. The last step is the application and signature, which takes about 3 minutes on your phone.\n\nWant me to send the link now, or call you while you complete it?${c.agentPhone ? ` My direct line is ${c.agentPhone}.` : ""}` +
      sign(c.agentName, c.agentPhone),
  },
  {
    id: "payment",
    label: "Payment / Bind",
    description: "Move from quote to active policy.",
    subject: () => `One step away from active coverage`,
    body: (c) =>
      `Hi ${c.firstName},\n\nWe're one step from getting your policy active — just the initial payment. Once it's in, coverage starts on the date we discussed and I'll send your ID cards right away.\n\nWant me to send the secure payment link or take it together over the phone?` +
      sign(c.agentName, c.agentPhone),
  },
  {
    id: "welcome",
    label: "Policy Issued / Welcome",
    description: "After the sale is completed.",
    subject: () => `You're covered — welcome aboard`,
    body: (c) =>
      `Hi ${c.firstName},\n\nWelcome aboard — your policy is officially issued. ID cards and documents are on the way.\n\nI'm your point of contact going forward, so if anything ever comes up (claim, change, question), reply to this email or call me directly${c.agentPhone ? ` at ${c.agentPhone}` : ""}. No phone trees.` +
      sign(c.agentName, c.agentPhone),
  },
  {
    id: "referral",
    label: "Referral Request",
    description: "Ask for referrals after a positive interaction.",
    subject: (c) => `Small favor${c.firstName ? `, ${c.firstName}` : ""}?`,
    body: (c) =>
      `Hi ${c.firstName},\n\nReally enjoyed helping you get this set up. Most of my best clients come from referrals, so if anyone in your circle is overpaying or up for renewal soon, just send them my way — I'll take great care of them.\n\nA quick reply with a name and number is all I need.` +
      sign(c.agentName, c.agentPhone),
  },
  {
    id: "cross-sell",
    label: "Cross-Sell",
    description: "Offer another product on top of current.",
    subject: () => `One more thing worth a quick look`,
    body: (c) =>
      `Hi ${c.firstName},\n\nSince we already have your info, it's pretty quick for me to check if bundling another line (home, life, umbrella) could save you more — most people who bundle save on what they already have with me.\n\nWant me to run the numbers? Just a yes and I'll handle it.` +
      sign(c.agentName, c.agentPhone),
  },
  {
    id: "win-back",
    label: "Win-Back",
    description: "Lost prospects or prior customers.",
    subject: (c) => `Checking back in${c.firstName ? `, ${c.firstName}` : ""}`,
    body: (c) =>
      `Hi ${c.firstName},\n\nIt's been a bit since we last talked. The market has changed and a lot of the people I quoted earlier this year are now saving on a re-shop.\n\nWorth me running fresh numbers for you? Just reply "yes" and I'll take it from there.` +
      sign(c.agentName, c.agentPhone),
  },
  {
    id: "breakup",
    label: "Final Attempt / Breakup",
    description: "One last try before closing the lead.",
    subject: (c) => `Should I close your file${c.firstName ? `, ${c.firstName}` : ""}?`,
    body: (c) =>
      `Hi ${c.firstName},\n\nI don't want to keep cluttering your inbox. If now isn't the right time, just reply "close it" and I'll stop reaching out.\n\nIf you do still want to see your options, reply "still interested" and I'll pick right back up.` +
      sign(c.agentName, c.agentPhone),
  },
];

export function EmailLeadButton({
  email,
  leadId,
  leadTable,
  firstName,
  lastName,
  phone,
  carrier,
  city,
  state,
  zip,
  quotedPremium,
  currentPremium,
  vehicles,
  vendorNotes,
  className,
  stopPropagation = true,
  children,
}: EmailLeadButtonProps) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [agentPhone, setAgentPhone] = useState<string | null>(null);
  const [path, setPath] = useState<string[]>([]);

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("direct_phone")
      .eq("id", profile.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setAgentPhone((data as { direct_phone?: string | null } | null)?.direct_phone ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  const hasEmail = !!email && email.trim().length > 0;

  const agentName = profile?.full_name?.trim() || profile?.company_name?.trim() || "Your agent";
  const ctx: TemplateCtx = {
    firstName: (firstName ?? "").trim() || "there",
    agentName,
    agentPhone,
    carrier,
    city,
    state,
    quotedPremium,
    currentPremium,
    vehicles,
  };

  const pick = async (t: EmailTemplate, e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    const href = `mailto:${email ?? ""}?subject=${encodeURIComponent(t.subject(ctx))}&body=${encodeURIComponent(t.body(ctx))}`;
    // Log activity BEFORE opening mailto so the insert actually flushes.
    // Previously this was fire-and-forget; some browsers cancel the
    // in-flight fetch when the mailto handler grabs focus, so the agent
    // never got credit. Await the insert and surface any error.
    if (profile?.id && leadId && leadTable) {
      try {
        const { error } = await supabase.from("lead_activities").insert({
          lead_id: leadId,
          lead_table: leadTable,
          user_id: profile.id,
          action: "email_sent",
          details: {
            template_id: t.id,
            template_label: t.label,
            recipient: email ?? null,
          },
        });
        if (error) console.error("[EmailLeadButton] activity log failed", error);
      } catch (err) {
        console.error("[EmailLeadButton] activity log threw", err);
      }
    }
    setOpen(false);
    setPath([]);
    window.location.href = href;
  };

  const byId = (id: string) => TEMPLATES.find((t) => t.id === id)!;

  type Node = {
    title: string;
    subtitle?: string;
    options: { label: string; description?: string; next?: Node; template?: EmailTemplate }[];
  };

  const tree: Node = {
    title: "Where are they in the process?",
    subtitle: "Pick the closest situation — we'll narrow it down in one more step.",
    options: [
      {
        label: "Haven't connected yet",
        description: "Brand new lead, or you just tried calling.",
        next: {
          title: "What just happened?",
          options: [
            { label: "First introduction", description: "Say hi and book a quick call.", template: byId("intro") },
            { label: "Just missed them on a call", description: "Pair your call attempt with a note.", template: byId("missed-call") },
          ],
        },
      },
      {
        label: "Working on the quote",
        description: "Mid-conversation — need info, sending numbers, handling pushback.",
        next: {
          title: "What do you need to do?",
          options: [
            { label: "Get a few more details", description: "Quote started, need info to finish.", template: byId("info-needed") },
            { label: "Share the quote", description: "Push to a quick walkthrough call.", template: byId("quote-ready") },
            { label: "Highlight savings", description: "Lead on price vs. current carrier.", template: byId("savings") },
            { label: "Reframe on coverage", description: "Shift conversation off price.", template: byId("coverage-review") },
            { label: "Request documents", description: "Dec page, license, vehicle info.", template: byId("doc-request") },
            { label: "Handle an objection", description: '"Just email it" / hesitation.', template: byId("objection") },
          ],
        },
      },
      {
        label: "Ready to close",
        description: "Confirming, signing, paying, or welcoming.",
        next: {
          title: "Which step?",
          options: [
            { label: "Confirm appointment", description: "You've set a call time.", template: byId("appt-confirm") },
            { label: "Send application / signature", description: "Last step before bind.", template: byId("application") },
            { label: "Take payment / bind", description: "Activate the policy.", template: byId("payment") },
            { label: "Welcome — policy issued", description: "Post-sale onboarding.", template: byId("welcome") },
          ],
        },
      },
      {
        label: "Existing client",
        description: "Referrals, bundling, renewals, or win-back.",
        next: {
          title: "What's the angle?",
          options: [
            { label: "Ask for a referral", template: byId("referral") },
            { label: "Offer a bundle / cross-sell", template: byId("cross-sell") },
            { label: "Renewal / re-shop", template: byId("requote") },
            { label: "Win-back (lost or dormant)", template: byId("win-back") },
          ],
        },
      },
      {
        label: "Older lead / Requote / Aged",
        description: "Cold lead, past quote window, or renewal re-shop.",
        next: {
          title: "What's the situation?",
          options: [
            { label: "Rates changed / fresh comparison", description: "Re-engage with updated pricing.", template: byId("aged-lead") },
            { label: "Near renewal", description: "Renewal or requote opportunity.", template: byId("requote") },
            { label: "Win-back (lost or dormant)", description: "One more try before closing the file.", template: byId("win-back") },
          ],
        },
      },
      {
        label: "They've gone quiet",
        description: "No response — nudge or close the file.",
        next: {
          title: "How hard do you want to push?",
          options: [
            { label: "Friendly follow-up", description: "Light nudge, no pressure.", template: byId("follow-up") },
            { label: "Final attempt", description: '"Should I close your file?"', template: byId("breakup") },
          ],
        },
      },
    ],
  };

  let current: Node = tree;
  for (const step of path) {
    const opt = current.options.find((o) => o.label === step);
    if (opt?.next) current = opt.next;
    else break;
  }

  return (
    <>
      <button
        type="button"
        title={hasEmail ? "Send email" : "No email on file"}
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation();
          setOpen(true);
        }}
        className={
          className ??
          "inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-sm font-medium bg-muted/60 hover:bg-muted text-foreground transition-colors"
        }
      >
        <Mail className="h-4 w-4" />
        {children ?? <span>Email</span>}
      </button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPath([]); }}>
        <DialogContent
          className="max-w-xl max-h-[85vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>{current.title}</DialogTitle>
            {current.subtitle ? (
              <DialogDescription>{current.subtitle}</DialogDescription>
            ) : null}
          </DialogHeader>

          {path.length > 0 && (
            <div className="-mt-1 mb-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => setPath((p) => p.slice(0, -1))}
              >
                <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                Back
              </Button>
            </div>
          )}

          <div className="grid gap-2">
            {current.options.map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={(e) => {
                  if (o.template) pick(o.template, e);
                  else setPath((p) => [...p, o.label]);
                }}
                className="flex flex-col items-start gap-0.5 rounded-md border bg-background p-3 text-left transition-colors hover:bg-muted hover:border-primary/40"
              >
                <span className="text-sm font-semibold text-foreground">{o.label}</span>
                {o.description ? (
                  <span className="text-xs text-muted-foreground">{o.description}</span>
                ) : null}
              </button>
            ))}
          </div>

          {vendorNotes && path.length === 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Lead notes aren't auto-inserted — review before sending.
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
