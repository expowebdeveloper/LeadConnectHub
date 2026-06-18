import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Mail } from "lucide-react";

type Vehicle = { year?: string | number | null; make?: string | null; model?: string | null };

type LeadInfo = {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  list_type: string | null;
  current_carrier: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  current_premium: number | null;
  quoted_premium: number | null;
  vehicles: Vehicle[] | null;
  created_at: string | null;
  lead_source: string | null;
  lead_type: string | null;
  lead_types: string[] | null;
  x_date: string | null;
  current_home_carrier: string | null;
  home_x_date: string | null;
  num_vehicles: number | null;
  release_count: number | null;
  last_released_at: string | null;
  dispo: string | null;
  home_dispo: string | null;
};

type Outcome = "voicemail" | "busy" | "no_answer_no_vm" | "connected";

type TemplateId =
  | "missed-call"
  | "vm-quote-ready"
  | "vm-follow-up"
  | "vm-savings-teaser"
  | "nudge-friendly"
  | "nudge-final"
  | "nudge-second-attempt"
  | "winback-voicemail"
  | "winback-nudge"
  | "connected-quote-ready"
  | "connected-appt-confirm"
  | "connected-doc-request"
  | "connected-follow-up"
  | "connected-thanks-no-fit";

type Refinement = {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "textarea";
};

type Template = {
  id: TemplateId;
  label: string;
  description: string;
  refinements?: Refinement[];
  subject: (c: Ctx, r: Record<string, string>) => string;
  body: (c: Ctx, r: Record<string, string>) => string;
};

type Ctx = {
  firstName: string;
  agentName: string;
  agentPhone: string | null;
  lead: LeadInfo;
  /** true when this is the first time anyone has logged a call for this lead. */
  isFirstTouch: boolean;
  /** "auto", "home", or "auto and home" — derived from lead lines. */
  lineLabel: string;
  /** Cleaned-up source phrase, e.g. "through our online quote form". null if unknown. */
  sourcePhrase: string | null;
  /** Upcoming renewal date phrase if x_date is in the future, else null. */
  renewalPhrase: string | null;
  /** Aged lead that's been worked before and is being re-engaged. */
  isWinback: boolean;
  /** Rough age of the lead in months — used for "almost a year ago" phrasing. */
  ageMonths: number | null;
};

/** Title-case names that come in as "JOESPH" or "joseph" → "Joseph". Preserves
 * common name prefixes (Mc, Mac, O'). Falls back to "there" for empty/junk. */
function formatFirstName(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "there";
  // Strip obvious junk like a single letter or all-punctuation
  if (!/[A-Za-z]/.test(s)) return "there";
  const fix = (word: string) => {
    if (!word) return word;
    const lower = word.toLowerCase();
    if (lower.startsWith("mc") && lower.length > 2) {
      return "Mc" + lower.charAt(2).toUpperCase() + lower.slice(3);
    }
    if (lower.startsWith("mac") && lower.length > 3) {
      return "Mac" + lower.charAt(3).toUpperCase() + lower.slice(4);
    }
    if (lower.startsWith("o'") && lower.length > 2) {
      return "O'" + lower.charAt(2).toUpperCase() + lower.slice(3);
    }
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };
  return s
    .split(/(\s|-)/)
    .map((piece) => (piece === " " || piece === "-" ? piece : fix(piece)))
    .join("");
}

/** Lead source values are messy (vendor codes, URLs, internal slugs). Only
 * surface them when they read like a clean, customer-facing label. */
function describeSource(raw: string | null): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  // Skip uuids, urls, all-caps codes, or obvious internal vendor slugs.
  if (/^https?:\/\//i.test(s)) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)) return null;
  if (s.length > 40) return null;
  const lower = s.toLowerCase();
  if (lower === "manual" || lower === "import" || lower === "unknown") return null;
  return `through ${s}`;
}

function describeRenewal(x: string | null, label: string): string | null {
  if (!x) return null;
  const d = new Date(x);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.floor((d.getTime() - Date.now()) / 86400000);
  if (days < -7 || days > 180) return null; // ignore far-past / far-future
  const when = d.toLocaleString("en-US", { month: "long", day: "numeric" });
  if (days < 0) return `Your ${label} policy renewal date (${when}) just passed`;
  if (days <= 14) return `Your ${label} policy renews on ${when} — only ${days} day${days === 1 ? "" : "s"} away`;
  return `Your ${label} policy renews on ${when}`;
}

function describeLines(lead: LeadInfo): string {
  const lines = (lead.lead_types && lead.lead_types.length > 0
    ? lead.lead_types
    : lead.lead_type
      ? [lead.lead_type]
      : []
  )
    .map((l) => l?.toLowerCase())
    .filter((l): l is string => !!l);
  const hasAuto = lines.includes("auto") || (lead.num_vehicles ?? 0) > 0 || (lead.vehicles?.length ?? 0) > 0;
  const hasHome = lines.includes("home") || !!lead.current_home_carrier;
  if (hasAuto && hasHome) return "auto and home";
  if (hasHome) return "home";
  return "auto";
}

const sign = (c: Ctx) =>
  `\n\nBest regards,\n${c.agentName}${c.agentPhone ? `\nDirect: ${c.agentPhone}` : ""}`;

/** Title-case a free-form place name like "FORT MYERS" → "Fort Myers". */
function titleCasePlace(raw: string | null): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  return s
    .toLowerCase()
    .split(/(\s|-)/)
    .map((p) => (p === " " || p === "-" || !p ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join("");
}
function placeLine(lead: LeadInfo): string | null {
  const city = titleCasePlace(lead.city);
  const state = (lead.state ?? "").trim().toUpperCase() || null;
  return [city, state].filter(Boolean).join(", ") || null;
}
function agePhrase(ageMonths: number | null): string | null {
  if (ageMonths == null || ageMonths < 3) return null;
  if (ageMonths < 6) return "a few months back";
  if (ageMonths < 12) return `about ${ageMonths} months back`;
  if (ageMonths < 18) return "about a year ago";
  if (ageMonths < 30) return "almost two years ago";
  return "a couple of years back";
}

const vehicleLine = (v: Vehicle[] | null) => {
  if (!v || v.length === 0) return "";
  const parts = v
    .map((x) => [x.year, x.make, x.model].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(", ");
  return parts ? ` on your ${parts}` : "";
};

const savingsLine = (lead: LeadInfo) => {
  if (lead.current_premium != null && lead.quoted_premium != null) {
    const diff = lead.current_premium - lead.quoted_premium;
    if (diff > 0) return `$${Math.round(diff).toLocaleString()}`;
  }
  return "";
};

const hasQuote = (lead: LeadInfo) => lead.quoted_premium != null;
const hasSavings = (lead: LeadInfo) =>
  lead.current_premium != null &&
  lead.quoted_premium != null &&
  lead.current_premium - lead.quoted_premium > 0;

/** Reusable reintroduction line for first-touch / older leads who may not
 * remember who we are. Honest about aged leads — never claims a recent inquiry. */
const reintroLine = (c: Ctx) => {
  const source = c.sourcePhrase ? ` ${c.sourcePhrase}` : "";
  // Avoid time claims entirely — many leads are aged and we don't know when
  // the original inquiry actually happened, only when the record was imported.
  return `My name is ${c.agentName} and I'm a licensed insurance agent. At some point you submitted a request for an ${c.lineLabel} insurance quote${source}, and your request was passed to me to follow up on.`;
};

/** Per-prospect context line that pulls in whatever specifics we know — carrier,
 * vehicles, city/state, upcoming renewal. Used to make the body feel custom. */
const specificsLine = (c: Ctx) => {
  const bits: string[] = [];
  if (c.lead.current_carrier) bits.push(`currently insured with ${c.lead.current_carrier}`);
  if (c.lead.vehicles && c.lead.vehicles.length > 0) {
    const v = c.lead.vehicles
      .slice(0, 2)
      .map((x) => [x.year, x.make, x.model].filter(Boolean).join(" "))
      .filter(Boolean)
      .join(" and ");
    if (v) bits.push(`covering your ${v}`);
  } else if (c.lead.num_vehicles && c.lead.num_vehicles > 0) {
    bits.push(`covering ${c.lead.num_vehicles} vehicle${c.lead.num_vehicles === 1 ? "" : "s"}`);
  }
  const place = [c.lead.city, c.lead.state].filter(Boolean).join(", ");
  if (place) bits.push(`here in ${place}`);
  if (bits.length === 0) return null;
  return `Based on what I have on file (${bits.join(", ")}), it's worth a quick conversation to see whether I can do better on rate, coverage, or both.`;
};

/** Short bullet list of what we know about the prospect — used to add
 * credibility ("I'm not a random caller — here's what's on file for you"). */
const onFileBullets = (c: Ctx): string | null => {
  const lines: string[] = [];
  if (c.lead.current_carrier) lines.push(`  \u2022 Current carrier: ${c.lead.current_carrier}`);
  if (c.lead.current_premium != null) {
    lines.push(`  \u2022 Current premium on file: $${Math.round(c.lead.current_premium).toLocaleString()}`);
  }
  if (c.lead.vehicles && c.lead.vehicles.length > 0) {
    const v = c.lead.vehicles
      .slice(0, 3)
      .map((x) => [x.year, x.make, x.model].filter(Boolean).join(" "))
      .filter(Boolean)
      .join(", ");
    if (v) lines.push(`  \u2022 Vehicle${c.lead.vehicles.length === 1 ? "" : "s"}: ${v}`);
  }
  const place = placeLine(c.lead);
  if (place) lines.push(`  \u2022 Location: ${place}`);
  if (c.lead.current_home_carrier) lines.push(`  \u2022 Home carrier: ${c.lead.current_home_carrier}`);
  const hasSubstantive =
    !!c.lead.current_carrier ||
    c.lead.current_premium != null ||
    (c.lead.vehicles && c.lead.vehicles.length > 0) ||
    !!c.lead.current_home_carrier;
  if (!hasSubstantive) return null;
  return lines.join("\n");
};

/** A one-sentence value pitch tailored to what we know. Always returns
 * something concrete so the email never feels generic. */
const valuePitch = (c: Ctx): string => {
  if (c.lead.current_carrier) {
    return `Most folks I review for ${c.lead.current_carrier} customers see a meaningful drop in premium, often a few hundred dollars a year, without sacrificing coverage. Even if I can't beat your rate, you'll walk away knowing exactly where you stand at renewal.`;
  }
  if (c.lineLabel.includes("home")) {
    return `Most ${c.lineLabel} reviews I run come back with either a lower premium or better coverage at the same price. Either way, you'll know exactly where you stand before your next renewal.`;
  }
  return `Even a five-minute call usually gives you a clear answer on whether you're overpaying — and what better looks like if you are.`;
};

const winbackPitch = (c: Ctx): string => {
  if (c.lead.current_carrier) {
    return `Our rates have improved, and we've been able to win back a number of ${c.lead.current_carrier} customers recently whose numbers weren't strong enough before. A short review will tell us whether the market has moved in your favor.`;
  }
  if (c.lineLabel.includes("home")) {
    return `Our pricing has improved, and we've been able to win back quite a few households recently whose numbers weren't compelling before. A short review will tell us whether this is a better market for you now.`;
  }
  return `Our rates have improved, and we've been able to win back quite a few people recently whose numbers weren't strong enough before. A short review will tell us whether the market has moved in your favor.`;
};

const TEMPLATES: Record<TemplateId, Template> = {
  "missed-call": {
    id: "missed-call",
    label: "First-touch voicemail follow-up",
    description: "Reintroduces you to a lead who may not remember the inquiry.",
    subject: (c) =>
      `Following up on your insurance quote request${c.firstName !== "there" ? `, ${c.firstName}` : ""}`,
    body: (c) =>
        `Hi ${c.firstName},\n\n${reintroLine(c)} I just tried calling and left you a brief voicemail.\n${
          c.renewalPhrase ? `\n${c.renewalPhrase}, so the timing is worth a look.\n` : ""
        }${specificsLine(c) ? `\n${specificsLine(c)}\n` : ""}\nWhen you have a few minutes, please reply with a good time to talk and I'll call you right back${
          c.agentPhone ? `, or feel free to reach me directly at ${c.agentPhone}` : ""
        }. The review itself takes less than ten minutes.\n\nIf you've already taken care of your insurance and no longer need a quote, just reply "all set" and I'll close out your file so you're not bothered again.` +
        sign(c),
  },
  "vm-quote-ready": {
    id: "vm-quote-ready",
    label: "Your quote is ready",
    description: "Numbers are prepared — invite them to a short review call.",
    subject: (c) => `Your insurance review is ready${c.firstName !== "there" ? `, ${c.firstName}` : ""}`,
    body: (c) =>
      `Hi ${c.firstName},\n\nI left you a voicemail — your quote${vehicleLine(c.lead.vehicles)} is finalized and ready to review.${
        hasSavings(c.lead)
          ? ` Based on what we have, it looks like a savings of approximately ${savingsLine(c.lead)} versus your ${c.lead.current_carrier ?? "current"} policy, and I'd like to walk through the coverage line by line before you decide.`
          : ` I'd like to walk through the coverage line by line so you can compare it against your ${c.lead.current_carrier ?? "current"} policy with confidence.`
      }\n\nWhat time today or tomorrow works best for a brief call?` +
      sign(c),
  },
  "vm-savings-teaser": {
    id: "vm-savings-teaser",
    label: "Savings highlight",
    description: "Lead with a concrete savings number to drive a callback.",
    subject: (c) => `Potential savings of ${savingsLine(c.lead)} on your auto policy`,
    body: (c) =>
      `Hi ${c.firstName},\n\nI just left you a voicemail. After reviewing the rate I was able to put together${vehicleLine(c.lead.vehicles)}, it looks like a potential savings of ${savingsLine(c.lead)} per term compared with your ${c.lead.current_carrier ?? "current"} carrier.\n\nBefore you make any decision I'd like to walk you through the coverage so you know exactly what you're getting. Please reply with a time that works, or call me back at your convenience.` +
      sign(c),
  },
  "vm-follow-up": {
    id: "vm-follow-up",
    label: "Brief follow-up (warm lead)",
    description: "Light voicemail follow-up for someone you've already been in touch with.",
    subject: (c) => `Following up${c.firstName !== "there" ? `, ${c.firstName}` : ""}`,
    body: (c) =>
      `Hi ${c.firstName},\n\nThis is ${c.agentName} — I just left a brief voicemail to pick back up on your ${c.lineLabel} insurance review${vehicleLine(c.lead.vehicles)}.${
        onFileBullets(c) ? `\n\nQuick refresher on what I have for you:\n${onFileBullets(c)}` : ""
      }${c.renewalPhrase ? `\n\n${c.renewalPhrase}, which is the perfect window to lock in a better rate before it auto-renews.` : ""}\n\n${valuePitch(c)}\n\nA one-line reply with a good time (or even a "not this week") is all I need and I'll work around your schedule.` +
      sign(c),
  },
  "nudge-friendly": {
    id: "nudge-friendly",
    label: "Tried to reach you",
    description: "Credibility-building note with a clear reason to call back.",
    subject: (c) => `Tried reaching you${c.firstName !== "there" ? `, ${c.firstName}` : ""}`,
    body: (c) =>
      `Hi ${c.firstName},\n\n${
        c.isFirstTouch
          ? `${reintroLine(c)} I tried calling a moment ago but wasn't able to reach you and didn't want to leave you wondering who called.`
          : `This is ${c.agentName}. I tried reaching you a moment ago to follow up on your ${c.lineLabel} insurance review${vehicleLine(c.lead.vehicles)}.`
      }${
        onFileBullets(c) ? `\n\nSo you know I'm not a random caller, here's what I already have on file for you:\n${onFileBullets(c)}` : ""
      }${c.renewalPhrase ? `\n\n${c.renewalPhrase}, which makes this a good window to lock in a better rate before auto-renewal.` : ""}\n\n${valuePitch(c)}\n\nIf you can share a window that works over the next day or two, I'll make a point of calling you right then. The conversation takes less than ten minutes${
        c.agentPhone ? `, or feel free to call me directly at ${c.agentPhone}` : ""
      }.` +
      sign(c),
  },
  "nudge-second-attempt": {
    id: "nudge-second-attempt",
    label: "Second attempt",
    description: "Acknowledges multiple attempts without sounding pushy.",
    subject: (c) => `Still trying to connect${c.firstName !== "there" ? `, ${c.firstName}` : ""}`,
    body: (c) =>
      `Hi ${c.firstName},\n\nThis is ${c.agentName} again. I've tried reaching you a couple of times now regarding the ${c.lineLabel} insurance quote request on file${
        c.sourcePhrase ? ` (${c.sourcePhrase})` : ""
      }, and I don't want to be a nuisance.\n\nIf you've already handled your insurance or it isn't a fit right now, just reply "all set" and I'll close out your file. If you'd still like to see what I can put together — especially if your renewal with ${c.lead.current_carrier ?? "your current carrier"} is coming up — a one-line reply with a callback window is all I need.` +
      sign(c),
  },
  "nudge-final": {
    id: "nudge-final",
    label: "Closing your file",
    description: "Respectful final touch — easy yes/no reply.",
    subject: (c) => `Should I close your file${c.firstName !== "there" ? `, ${c.firstName}` : ""}?`,
    body: (c) =>
      `Hi ${c.firstName},\n\nThis is ${c.agentName}. I don't want to keep filling your inbox, so this will be my last note for now.\n\nIf the timing isn't right or you've already taken care of your insurance, simply reply "close it" and I'll respectfully step back.\n\nIf you'd still like me to put a quote together, reply "still interested" and I'll pick right back up.\n\nEither answer works — I just want to respect your time.` +
      sign(c),
  },
  "connected-quote-ready": {
    id: "connected-quote-ready",
    label: "Quote recap",
    description: "Confirms the numbers you just walked through.",
    subject: (c) => `Recap of your insurance quote${c.firstName !== "there" ? `, ${c.firstName}` : ""}`,
    body: (c) =>
      `Hi ${c.firstName},\n\nThank you for taking the time to speak with me today. As promised, here is a written recap of your quote${vehicleLine(c.lead.vehicles)}:\n${
        c.lead.quoted_premium != null ? `\n  \u2022 Proposed premium: $${Math.round(c.lead.quoted_premium).toLocaleString()}` : ""
      }${c.lead.current_premium != null ? `\n  \u2022 Current with ${c.lead.current_carrier ?? "your carrier"}: $${Math.round(c.lead.current_premium).toLocaleString()}` : ""}${hasSavings(c.lead) ? `\n  \u2022 Estimated savings: ${savingsLine(c.lead)}` : ""}\n\nWhen you're ready to move forward, simply reply to this email or give me a call and I'll have you bound in just a few minutes.` +
      sign(c),
  },
  "connected-appt-confirm": {
    id: "connected-appt-confirm",
    label: "Appointment confirmation",
    description: "Confirms a scheduled callback and what to have ready.",
    refinements: [
      { key: "time", label: "Appointment time", placeholder: "e.g. Thursday at 2:30 PM CT" },
    ],
    subject: (_, r) => (r.time ? `Confirming our call \u2014 ${r.time}` : `Confirming our scheduled call`),
    body: (c, r) =>
      `Hi ${c.firstName},\n\nThis is to confirm our call${r.time ? ` for ${r.time}` : ""}. I'll be calling you${c.agentPhone ? ` from ${c.agentPhone}` : ""}.\n\nTo make the most of our time, please have the following ready if possible:\n  \u2022 Your current declarations page (a photo from your phone is fine)\n  \u2022 Driver's license for each driver on the policy\n\nIf anything changes between now and then, just reply to this email and I'll adjust.` +
      sign(c),
  },
  "connected-doc-request": {
    id: "connected-doc-request",
    label: "Document request",
    description: "Requests dec page, license, and any extras to finalize.",
    refinements: [
      { key: "items", label: "Anything else needed (optional)", placeholder: "e.g. VIN for the new vehicle" },
    ],
    subject: () => `A few quick items to finalize your quote`,
    body: (c, r) =>
      `Hi ${c.firstName},\n\nThank you for your time today. To finalize the quote we discussed, I just need a few quick items:\n\n  \u2022 Current declarations page (photos from your phone are perfectly fine)\n  \u2022 Driver's license for each driver${r.items ? `\n  \u2022 ${r.items}` : ""}\n\nThe simplest path is to reply directly to this email with the photos attached. Once I have them, I can lock in the rate and email back the final paperwork for signature.` +
      sign(c),
  },
  "connected-follow-up": {
    id: "connected-follow-up",
    label: "Follow up later",
    description: "For prospects who asked for time to think it over.",
    refinements: [
      { key: "when", label: "When should you circle back?", placeholder: "e.g. early next week" },
    ],
    subject: (c) => `Following up${c.firstName !== "there" ? `, ${c.firstName}` : ""}`,
    body: (c, r) =>
      `Hi ${c.firstName},\n\nThank you for the conversation today. As discussed, I'll circle back${r.when ? ` ${r.when}` : " soon"} so you have time to review everything without any pressure from me in the meantime.\n\nIf a question comes up before then, please don't hesitate to reply to this email${c.agentPhone ? ` or reach me directly at ${c.agentPhone}` : ""}.` +
      sign(c),
  },
  "connected-thanks-no-fit": {
    id: "connected-thanks-no-fit",
    label: "Thank you (not a fit today)",
    description: "Polished close when the timing or fit isn't right.",
    subject: (c) => `Thank you${c.firstName !== "there" ? `, ${c.firstName}` : ""}`,
    body: (c) =>
      `Hi ${c.firstName},\n\nThank you again for your time today. I completely understand this isn't the right fit at the moment.\n\nIf anything changes — a renewal coming up, a new vehicle, or a move — please keep my information handy. I'd be glad to help when the timing is better, and referrals to friends or family are always appreciated.` +
      sign(c),
  },
  "winback-voicemail": {
    id: "winback-voicemail",
    label: "Winback \u2014 voicemail follow-up",
    description: "Re-engages an aged lead with an honest \u201Cit's been a while\u201D angle.",
    subject: () => `Worth taking another look?`,
    body: (c) =>
      `Hi ${c.firstName},\n\nThis is ${c.agentName} with Anchor Line Insurance. I just left you a quick voicemail.\n\nI'm reaching out because our ${c.lineLabel} rates have improved, and I've been able to win back several clients whose numbers did not work before.\n\nIt may be worth taking another look now. A quick review will show us fast whether the market has moved in your favor.\n\nIf I can improve the numbers, I'll show you. If I can't, I'll tell you directly.\n\nReply with a good time window today${
        c.agentPhone ? `, or call me directly at ${c.agentPhone}` : ""
      }.` + sign(c),
  },
  "winback-nudge": {
    id: "winback-nudge",
    label: "Winback \u2014 no answer",
    description: "Re-engagement note after no answer on an aged lead.",
    subject: () => `Worth taking another look?`,
    body: (c) =>
      `Hi ${c.firstName},\n\nThis is ${c.agentName} with Anchor Line Insurance. I just tried reaching you and wanted to follow up in writing.\n\nI'm reaching out because our ${c.lineLabel} rates have improved, and I've been able to win back several clients whose numbers did not work before.\n\nIt may be worth taking another look now. A quick review will show us fast whether the market has moved in your favor.\n\nIf I can improve the numbers, I'll show you. If I can't, I'll tell you directly.\n\nReply with a good time window today${
        c.agentPhone ? `, or call me directly at ${c.agentPhone}` : ""
      }.` + sign(c),
  },
};

/**
 * Build the recommended template list for an outcome, given what we know
 * about the lead. Templates that don't make sense for this lead are filtered
 * out (e.g. don't suggest a savings teaser when there's no quoted premium).
 */
function pickTemplates(
  outcome: Outcome,
  lead: LeadInfo | null,
  isFirstTouch: boolean,
  priorCallCount: number,
  isWinback: boolean,
): TemplateId[] {
  const quote = !!lead && hasQuote(lead);
  const savings = !!lead && hasSavings(lead);

  switch (outcome) {
    case "voicemail": {
      if (isWinback) return ["winback-voicemail"];
      const list: TemplateId[] = [];
      list.push("missed-call");
      if (quote) list.push("vm-quote-ready");
      if (savings) list.push("vm-savings-teaser");
      if (!isFirstTouch) list.push("vm-follow-up");
      return list;
    }
    case "busy":
    case "no_answer_no_vm": {
      if (isWinback) return ["winback-nudge"];
      const list: TemplateId[] = [];
      list.push("nudge-friendly");
      if (priorCallCount >= 1) list.push("nudge-second-attempt");
      if (priorCallCount >= 2) list.push("nudge-final");
      return list;
    }
    case "connected": {
      const list: TemplateId[] = [];
      if (quote) list.push("connected-quote-ready");
      list.push("connected-appt-confirm", "connected-doc-request", "connected-follow-up", "connected-thanks-no-fit");
      return list;
    }
  }
}

const OUTCOME_LABEL: Record<Outcome, string> = {
  voicemail: "voicemail",
  busy: "busy signal",
  no_answer_no_vm: "no-answer",
  connected: "connected call",
};

export type PostCallEmailRequest = {
  outcome: Outcome;
  leadId: string;
  leadTable: "leads" | "list_leads";
};

export function PostCallEmailPrompt({
  request,
  onClose,
}: {
  request: PostCallEmailRequest | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { profile, realUser, user } = useAuth();
  const [lead, setLead] = useState<LeadInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [agentPhone, setAgentPhone] = useState<string | null>(null);
  const [priorCallCount, setPriorCallCount] = useState(0);
  // Reset on each new request
  useEffect(() => {
    setLead(null);
    setPriorCallCount(0);
    if (!request) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .from(request.leadTable)
      .select(
        "email,first_name,last_name,phone,list_type,current_carrier,city,state,zip,current_premium,quoted_premium,vehicles,created_at,lead_source,lead_type,lead_types,x_date,current_home_carrier,home_x_date,num_vehicles,release_count,last_released_at,dispo,home_dispo",
      )
      .eq("id", request.leadId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setLead((data as LeadInfo | null) ?? null);
        setLoading(false);
      });
    // Count prior call_logged activities so we can tell first-touch from follow-up.
    // Subtract 1 for the call we just logged that opened this prompt.
    supabase
      .from("lead_activities" as never)
      .select("id", { count: "exact", head: true })
      .eq("lead_id", request.leadId)
      .eq("lead_table", request.leadTable)
      .eq("action", "call_logged")
      .then(({ count }) => {
        if (cancelled) return;
        setPriorCallCount(Math.max(0, (count ?? 0) - 1));
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

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

  const ctx: Ctx | null = useMemo(() => {
    if (!lead) return null;
    const lineLabel = describeLines(lead);
    const renewalPhrase =
      describeRenewal(lead.x_date, "auto") ?? describeRenewal(lead.home_x_date, "home");
    let ageMonths: number | null = null;
    if (lead.created_at) {
      const d = new Date(lead.created_at);
      if (!Number.isNaN(d.getTime())) {
        ageMonths = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30));
      }
    }
    const coldDispos = new Set(["not_interested", "no_show", "lost", "callback", "closed", "dnc"]);
    const isCold = (d: string | null) => !!d && coldDispos.has(d.toLowerCase());
    const listType = (lead.list_type ?? "").toLowerCase();
    const isWinback =
      listType === "winback" ||
      (lead.release_count ?? 0) > 0 ||
      !!lead.last_released_at ||
      ((ageMonths ?? 0) >= 3 && priorCallCount >= 1) ||
      isCold(lead.dispo) ||
      isCold(lead.home_dispo);
    return {
      firstName: formatFirstName(lead.first_name),
      agentName: profile?.full_name?.trim() || profile?.company_name?.trim() || "Your agent",
      agentPhone,
      lead,
      isFirstTouch: priorCallCount === 0,
      lineLabel,
      sourcePhrase: describeSource(lead.lead_source),
      renewalPhrase,
      isWinback,
      ageMonths,
    };
  }, [lead, profile, agentPhone, priorCallCount]);

  if (!request) return null;

  const hasEmail = !!lead?.email && lead.email.trim().length > 0;

  const send = async (id: TemplateId) => {
    if (!ctx || !lead?.email) return;
    const t = TEMPLATES[id];
    const subject = t.subject(ctx, {});
    const body = t.body(ctx, {});
    const actorUserId = realUser?.id ?? user?.id ?? null;
    // Log email_sent so it counts toward the agent's activity score.
    // Await before opening mailto so the request actually flushes.
    if (actorUserId && request) {
      try {
        const { error } = await supabase.from("lead_activities").insert({
          lead_id: request.leadId,
          lead_table: request.leadTable,
          user_id: actorUserId,
          action: "email_sent",
          details: {
            template_id: t.id,
            template_label: t.label,
            recipient: lead.email,
            source: "post_call_prompt",
            outcome: request.outcome,
          },
        });
        if (error) {
          console.error("[PostCallEmailPrompt] activity log failed", error);
        } else {
          queryClient.invalidateQueries({ queryKey: ["lead_activities", request.leadTable, request.leadId] });
          queryClient.invalidateQueries({ queryKey: ["analytics"] });
          queryClient.invalidateQueries({ queryKey: ["hub-analytics"] });
        }
      } catch (err) {
        console.error("[PostCallEmailPrompt] activity log threw", err);
      }
    }
    onClose();
    window.location.href = `mailto:${lead.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Send a follow-up email?
          </DialogTitle>
          <DialogDescription>
            {`Based on the ${OUTCOME_LABEL[request.outcome]}, here are tailored email options${lead?.first_name ? ` for ${lead.first_name}` : ""}. Personalized with what we know about the lead.`}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading lead…</p>
        ) : !hasEmail ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No email on file for this lead — skipping email follow-up.
            </p>
            <div className="flex justify-end">
              <Button variant="outline" onClick={onClose}>Close</Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            {pickTemplates(
              request.outcome,
              lead,
              priorCallCount === 0,
              priorCallCount,
              !!ctx?.isWinback,
            ).map((id) => {
              const t = TEMPLATES[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => send(id)}
                  disabled={!ctx}
                  className="flex flex-col items-start gap-0.5 rounded-md border bg-background p-3 text-left transition-colors hover:bg-muted hover:border-primary/40"
                >
                  <span className="text-sm font-semibold text-foreground">{t.label}</span>
                  <span className="text-xs text-muted-foreground">{t.description}</span>
                </button>
              );
            })}
            <div className="mt-1 flex justify-end">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Skip email
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}