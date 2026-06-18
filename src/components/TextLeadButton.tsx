import { useEffect, useMemo, useState } from "react";
import { MessageSquare, Copy, ExternalLink, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Vehicle = { year: string | number | null; make: string | null; model: string | null };

export interface TextLeadButtonProps {
  phone: string | null | undefined;
  /** Lead id used to log the text-sent activity. Optional but recommended. */
  leadId?: string | null;
  leadTable?: "leads" | "list_leads" | null;
  firstName?: string | null;
  lastName?: string | null;
  carrier?: string | null;
  city?: string | null;
  state?: string | null;
  quotedPremium?: number | null;
  currentPremium?: number | null;
  vehicles?: Vehicle[] | null;
  className?: string;
  stopPropagation?: boolean;
  children?: React.ReactNode;
}

type TemplateCtx = {
  firstName: string;
  agentName: string;
  agentFirst: string;
  agentPhone?: string | null;
  carrier?: string | null;
  city?: string | null;
  state?: string | null;
  quotedPremium?: number | null;
  currentPremium?: number | null;
  vehicles?: Vehicle[] | null;
};

type TextTemplate = {
  id: string;
  label: string;
  description: string;
  body: (c: TemplateCtx) => string;
};

const vehiclesShort = (v?: Vehicle[] | null) => {
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
    if (diff > 0) return ` about $${Math.round(diff).toLocaleString()}`;
  }
  return "";
};

const TEMPLATES: TextTemplate[] = [
  {
    id: "custom",
    label: "Custom message",
    description: "Write your own from scratch.",
    body: (c) =>
      `Hi ${c.firstName}, it's ${c.agentFirst}.`,
  },
  {
    id: "intro",
    label: "Intro / First touch",
    description: "New lead — quick intro and ask for a callback.",
    body: (c) =>
      `Hi ${c.firstName}, this is ${c.agentFirst} on the insurance quote you requested${vehiclesShort(c.vehicles)}. When's a good 5 min to connect today? — ${c.agentFirst}`,
  },
  {
    id: "missed-call",
    label: "Just missed you",
    description: "Pair with a call attempt — no answer / voicemail.",
    body: (c) =>
      `Hi ${c.firstName}, ${c.agentFirst} here — just tried you about your quote and didn't want to leave you hanging. Reply with a time that works and I'll call right then.`,
  },
  {
    id: "info-needed",
    label: "Need a couple details",
    description: "Quote started, need a few details to finalize.",
    body: (c) =>
      `Hi ${c.firstName}, ${c.agentFirst} here. I'm almost done with your quote${vehiclesShort(c.vehicles)} — just need a couple quick details. Good to call you now?`,
  },
  {
    id: "quote-ready",
    label: "Quote ready",
    description: "Push to a quick walkthrough call.",
    body: (c) =>
      `Hi ${c.firstName}, your quote is ready. I'd rather walk you through it for 3 min than just send numbers — does later today or tomorrow morning work better? — ${c.agentFirst}`,
  },
  {
    id: "savings",
    label: "Savings opportunity",
    description: "Lead with potential savings vs. current carrier.",
    body: (c) =>
      `Hi ${c.firstName}, looks like I can save you${savings(c) || " on your current policy"}${c.carrier ? ` vs. ${c.carrier}` : ""}. Got 5 min for a quick call to confirm? — ${c.agentFirst}`,
  },
  {
    id: "appt-reminder",
    label: "Appointment reminder",
    description: "Confirm a scheduled call time.",
    body: (c) =>
      `Hi ${c.firstName}, ${c.agentFirst} confirming our call. Please have your current declarations page handy if you can — makes the comparison much faster. Talk soon.`,
  },
  {
    id: "follow-up",
    label: "Follow-up / no response",
    description: "After no answer or no response.",
    body: (c) =>
      `Hi ${c.firstName}, ${c.agentFirst} circling back on your quote. A quick "good time" or "not now" is all I need and I'll work around your schedule.`,
  },
  {
    id: "doc-request",
    label: "Document request",
    description: "Need dec page / license / vehicle info to finish.",
    body: (c) =>
      `Hi ${c.firstName}, to finish your quote I just need a photo of your current declarations page and driver's license. Easiest to text them right back to this number — thanks! — ${c.agentFirst}`,
  },
  {
    id: "payment",
    label: "Ready to bind",
    description: "Move from quote to active policy.",
    body: (c) =>
      `Hi ${c.firstName}, one step from active coverage — just the initial payment. Want me to send the secure link, or take it together on a quick call? — ${c.agentFirst}`,
  },
  {
    id: "breakup",
    label: "Final attempt",
    description: "One last try before closing the lead.",
    body: (c) =>
      `Hi ${c.firstName}, don't want to keep bugging you. If now isn't the right time just reply "close it" — if you're still interested reply "still in" and I'll pick right back up. — ${c.agentFirst}`,
  },
];

const HEARSAY_URL =
  "https://my.hearsaysocial.com/150/group/1223277/messages/conversations";

function normalizePhone(input: string | null | undefined): string {
  if (!input) return "";
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 0) return digits;
  return "";
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function TextLeadButton({
  phone,
  leadId,
  leadTable,
  firstName,
  lastName,
  carrier,
  city,
  state,
  quotedPremium,
  currentPremium,
  vehicles,
  className,
  stopPropagation = true,
  children,
}: TextLeadButtonProps) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [agentPhone, setAgentPhone] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string>("intro");
  const [body, setBody] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("direct_phone")
      .eq("id", profile.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled)
          setAgentPhone((data as { direct_phone?: string | null } | null)?.direct_phone ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  const agentName = profile?.full_name?.trim() || profile?.company_name?.trim() || "Your agent";
  const agentFirst = (profile?.full_name?.trim().split(/\s+/)[0]) || agentName;

  const ctx: TemplateCtx = useMemo(
    () => ({
      firstName: (firstName ?? "").trim() || "there",
      agentName,
      agentFirst,
      agentPhone,
      carrier,
      city,
      state,
      quotedPremium,
      currentPremium,
      vehicles,
    }),
    [firstName, agentName, agentFirst, agentPhone, carrier, city, state, quotedPremium, currentPremium, vehicles],
  );

  // Re-render body whenever the chosen template or context changes.
  useEffect(() => {
    const t = TEMPLATES.find((x) => x.id === templateId) ?? TEMPLATES[0];
    setBody(t.body(ctx));
    setCopied(false);
  }, [templateId, ctx]);

  const hasPhone = !!phone && phone.trim().length > 0;
  const normalized = useMemo(() => normalizePhone(phone), [phone]);
  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim() || "this lead";

  const logActivity = async (extra?: { copy_only?: boolean }) => {
    if (!profile?.id || !leadId || !leadTable) return;
    try {
      const tpl = TEMPLATES.find((t) => t.id === templateId);
      const { error } = await supabase.from("lead_activities").insert({
        lead_id: leadId,
        lead_table: leadTable,
        user_id: profile.id,
        action: "text_sent_via_hearsay",
        details: {
          template_id: templateId,
          template_label: tpl?.label ?? templateId,
          recipient: normalized || phone,
          preview: body.slice(0, 140),
          copy_only: !!extra?.copy_only,
        },
      });
      if (error) console.error("[TextLeadButton] activity log failed", error);
    } catch (err) {
      console.error("[TextLeadButton] activity log threw", err);
    }
  };

  const handleCopy = async (alsoOpen: boolean) => {
    // Include the recipient at the top so the agent can paste it into Hearsay's
    // "To" field if they want — Hearsay's compose view doesn't accept a
    // prefilled body via URL, so this is the cleanest hand-off.
    const payload = normalized ? `${normalized}\n\n${body}` : body;
    const ok = await writeClipboard(payload);
    if (!ok) {
      toast.error("Couldn't copy to clipboard — copy it manually.");
      return;
    }
    setCopied(true);
    void logActivity({ copy_only: !alsoOpen });
    if (alsoOpen) {
      toast.success("Message copied — paste into Hearsay.");
      window.open(HEARSAY_URL, "_blank", "noopener,noreferrer");
      setOpen(false);
    } else {
      toast.success("Message copied to clipboard.");
    }
  };

  const handleTrigger = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    if (!hasPhone) {
      toast.error("No phone number on file for this lead.");
      return;
    }
    // Default to Intro on open.
    setTemplateId((prev) => prev || "intro");
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleTrigger}
        disabled={!hasPhone}
        title={hasPhone ? `Text ${displayName} via Hearsay` : "No phone on file"}
        className={
          className ??
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-sm font-medium text-primary bg-primary/10 hover:bg-primary/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        }
      >
        {children ?? (
          <>
            <MessageSquare className="h-3.5 w-3.5" /> Text
          </>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Text {displayName} via Hearsay
            </DialogTitle>
            <DialogDescription>
              Hearsay doesn't accept prefilled messages from outside. Pick a template, then we'll copy the message (with the recipient's number) and open Hearsay so you can paste and send.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <div className="text-xs text-muted-foreground">Recipient</div>
              <div className="font-medium">{phone || "—"}</div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Template</label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {TEMPLATES.find((t) => t.id === templateId)?.description}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Message</label>
              <Textarea
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setCopied(false);
                }}
                rows={6}
                className="resize-none"
              />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{body.length} chars</span>
                <span>SMS segments split around 160 chars</span>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => handleCopy(false)}>
              {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
              {copied ? "Copied" : "Just copy"}
            </Button>
            <Button type="button" onClick={() => handleCopy(true)}>
              <ExternalLink className="mr-1.5 h-4 w-4" /> Copy & open Hearsay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}