// Guided call script decision trees.
// Each tree is keyed by a "lead kind" and contains:
//   - opener: first agent line shown when "Connected" is chosen
//   - voicemail: script shown when "Voicemail" is chosen
//   - nodes: graph of decision points. Each node has agent text + response
//     options that route to the next node id.
// Terminal node ids start with "end_". Special routing ids reuse nodes
// across trees (e.g. "obj_not_interested").

export type CallResult =
  | "connected"
  | "voicemail"
  | "no_answer"
  | "bad_number"
  | "wrong_number"
  | "busy"
  | "gatekeeper"
  | "spouse"
  | "spanish"
  | "dnc"
  | "hangup";

export const CALL_RESULTS: { value: CallResult; label: string; tone?: "ok" | "warn" | "bad" }[] = [
  { value: "connected", label: "Connected with prospect", tone: "ok" },
  { value: "voicemail", label: "Voicemail" },
  { value: "no_answer", label: "No answer" },
  { value: "busy", label: "Busy / call failed" },
  { value: "gatekeeper", label: "Gatekeeper answered" },
  { value: "spouse", label: "Spouse / household member" },
  { value: "spanish", label: "Spanish speaker", tone: "warn" },
  { value: "wrong_number", label: "Wrong number", tone: "warn" },
  { value: "bad_number", label: "Bad / disconnected", tone: "warn" },
  { value: "dnc", label: "Asked for DNC", tone: "bad" },
  { value: "hangup", label: "Hung up immediately", tone: "bad" },
];

export type ResponseOption = {
  label: string;
  next: string; // node id
  dispo?: string; // optional CRM dispo to set
  flag?: "dnc" | "wrong_number" | "bad_number" | "callback" | "quote_started" | "quote_ready" | "bound";
};

export type ScriptNode = {
  id: string;
  title: string;
  agent: string; // what the agent should say
  hint?: string; // optional coaching note shown above the agent text
  responses?: ResponseOption[]; // empty/undefined = terminal
};

export type ScriptTree = {
  key: LeadKind;
  label: string;
  description: string;
  opener: ScriptNode; // node shown after "Connected"
  voicemail: string;
  nodes: Record<string, ScriptNode>;
};

export type LeadKind =
  | "aged_auto"
  | "fresh_internet_auto"
  | "quote_followup"
  | "requote";

export const LEAD_KINDS: { value: LeadKind; label: string }[] = [
  { value: "aged_auto", label: "Aged Auto" },
  { value: "fresh_internet_auto", label: "Fresh Internet Auto" },
  { value: "quote_followup", label: "Quote Follow-Up" },
  { value: "requote", label: "Requote" },
];

// Shared objection nodes — reused by every tree.
const sharedObjections: Record<string, ScriptNode> = {
  obj_already_insured: {
    id: "obj_already_insured",
    title: "Objection: already insured",
    agent:
      "Absolutely, and most people we help already do. The question isn't whether you have insurance — it's whether you're paying more than you need to for the same or better coverage. Let's just compare it quickly. Who are you with right now?",
    responses: [
      { label: "Gave carrier", next: "quote_vehicles" },
      { label: "Still not interested", next: "obj_not_interested" },
      { label: "Call me later", next: "obj_call_later" },
      { label: "Do not call", next: "end_dnc", flag: "dnc" },
    ],
  },
  obj_not_interested: {
    id: "obj_not_interested",
    title: "Objection: not interested",
    agent:
      "I understand — most people aren't excited to talk about insurance. But if your current rate could be improved without cutting coverage, that's at least worth knowing. I'll check it quickly, and if it's not better, I'll tell you. Who are you insured with right now?",
    responses: [
      { label: "Gave carrier", next: "quote_vehicles" },
      { label: "Still not interested", next: "end_not_interested", dispo: "dead" },
      { label: "Hangs up", next: "end_hangup" },
      { label: "Do not call", next: "end_dnc", flag: "dnc" },
    ],
  },
  obj_just_email: {
    id: "obj_just_email",
    title: "Objection: just email me",
    agent:
      "I can send you something, but I don't want to email a generic estimate that's wrong. Rates change with carrier, vehicles, drivers, and discounts. Let me grab the basics now so what I send is an actual quote worth looking at. Who are you currently insured with?",
    responses: [
      { label: "Gave carrier", next: "quote_vehicles" },
      { label: "Email only", next: "end_email_only", dispo: "follow_up" },
      { label: "Refuses", next: "obj_not_interested" },
    ],
  },
  obj_busy: {
    id: "obj_busy",
    title: "Objection: I'm busy",
    agent:
      "No problem — I'll make it quick. I only need two things to see if it's even worth your time: who you're with and how many vehicles are in the household. Who's your current carrier?",
    responses: [
      { label: "Gave carrier", next: "quote_vehicles" },
      { label: "Schedule callback", next: "end_callback", flag: "callback", dispo: "follow_up" },
      { label: "Hangs up", next: "end_hangup" },
    ],
  },
  obj_call_later: {
    id: "obj_call_later",
    title: "Objection: call me later",
    agent:
      "I can, but before I do, let me at least get the basics so the next call is useful. Otherwise I'll just be calling back to ask the same questions. Who are you currently insured with?",
    responses: [
      { label: "Gave carrier", next: "quote_vehicles" },
      { label: "Set callback time", next: "end_callback", flag: "callback", dispo: "follow_up" },
      { label: "Refuses", next: "obj_not_interested" },
    ],
  },
  obj_how_got_number: {
    id: "obj_how_got_number",
    title: "Objection: how did you get my number?",
    agent:
      "Your information came through from a previous insurance inquiry — likely when you were checking rates online. I'm only reaching out to see if it still makes sense to compare. If we can't improve it, I'll let you know. Who are you currently insured with?",
    responses: [
      { label: "Accepts, gave carrier", next: "quote_vehicles" },
      { label: "Still upset", next: "obj_not_interested" },
      { label: "Do not call", next: "end_dnc", flag: "dnc" },
    ],
  },
  quote_vehicles: {
    id: "quote_vehicles",
    title: "Quote: vehicles & drivers",
    agent:
      "Great. Let's start with the vehicles. What's the year, make, and model of the first vehicle? (Then: any others? Then drivers, DOB, accidents/tickets in the last 3–5 years, garaging ZIP, renewal date, finance status, email.)",
    hint: "Capture into the lead record as you go.",
    responses: [
      { label: "Got full info → run quote", next: "end_quote_ready", flag: "quote_ready", dispo: "quoted" },
      { label: "Partial — needs callback", next: "end_callback", flag: "quote_started", dispo: "follow_up" },
      { label: "Refuses to give info", next: "obj_not_interested" },
      { label: "Needs spouse", next: "end_callback", flag: "callback", dispo: "follow_up" },
    ],
  },
  end_callback: {
    id: "end_callback",
    title: "Schedule callback",
    agent:
      "No problem. What's better — later today around [time] or tomorrow morning around [time]? I'll put a reminder in so you don't have to chase me.",
  },
  end_dnc: {
    id: "end_dnc",
    title: "DNC request",
    agent:
      "Understood. I'll make sure you're marked as do not contact. Have a good day.",
    hint: "Do not continue pitching. The system will flag this number as DNC.",
  },
  end_not_interested: {
    id: "end_not_interested",
    title: "Not interested — close",
    agent: "No problem, thanks for your time. Have a good one.",
  },
  end_hangup: {
    id: "end_hangup",
    title: "Prospect hung up",
    agent: "Log the attempt and move on.",
  },
  end_email_only: {
    id: "end_email_only",
    title: "Email follow-up",
    agent:
      "Confirm best email address, send a follow-up with a short rate-review note, and create a callback task for 2 business days out.",
  },
  end_quote_ready: {
    id: "end_quote_ready",
    title: "Quote ready",
    agent:
      "Perfect. I'm going to run this now and compare it against what you currently have. Same or better coverage, better rate if possible. If it doesn't beat what you have, I'll tell you.",
    hint: "Move lead to Quoted / Ready to bind once you've presented numbers.",
  },
  // Universal call-result branches (non-connected)
  res_wrong_number: {
    id: "res_wrong_number",
    title: "Wrong number",
    agent:
      "Sorry about that. I'll update our records so we don't keep calling this number. Have a good day.",
    hint: "Marks the phone as wrong number and stops further calls to it.",
  },
  res_bad_number: {
    id: "res_bad_number",
    title: "Bad / disconnected number",
    agent:
      "Mark the number invalid. Check the lead for an alternate phone or email and create the next-step task.",
  },
  res_no_answer: {
    id: "res_no_answer",
    title: "No answer",
    agent:
      "Log the attempt and schedule the next follow-up. Keep the lead active unless max attempts have been hit.",
  },
  res_busy: {
    id: "res_busy",
    title: "Busy / call failed",
    agent: "Log the attempt and try again later. Don't penalize the lead.",
  },
  res_gatekeeper: {
    id: "res_gatekeeper",
    title: "Gatekeeper",
    agent:
      "Hi, this is [Agent] with Anchor Line Insurance. I'm trying to reach [Prospect] regarding an insurance quote request — what's the best way to get [him/her/them] on the line?",
    responses: [
      { label: "Prospect available", next: "opener" },
      { label: "Not available — get callback time", next: "end_callback", flag: "callback" },
      { label: "Asked what it's about", next: "gk_soft" },
      { label: "Wrong number", next: "res_wrong_number", flag: "wrong_number" },
      { label: "Do not call", next: "end_dnc", flag: "dnc" },
    ],
  },
  gk_soft: {
    id: "gk_soft",
    title: "Gatekeeper: soft explanation",
    agent:
      "It's just regarding an insurance rate review they had looked into. I wanted to follow up and see if it still made sense to compare options.",
    responses: [
      { label: "Puts prospect on", next: "opener" },
      { label: "Takes a message", next: "end_callback", flag: "callback" },
    ],
  },
  res_spouse: {
    id: "res_spouse",
    title: "Spouse / household member",
    agent:
      "Hi, this is [Agent] with Anchor Line Insurance. I'm calling about an auto insurance rate review for the household — who handles the insurance decisions over there?",
    responses: [
      { label: "They are involved", next: "opener" },
      { label: "Not involved — get callback", next: "end_callback", flag: "callback" },
      { label: "Wrong number", next: "res_wrong_number", flag: "wrong_number" },
    ],
  },
  res_spanish: {
    id: "res_spanish",
    title: "Spanish speaker",
    agent:
      "Un momento, por favor. Voy a pedirle a alguien que habla español que le ayude.",
    hint: "Set the lead's language to Spanish and route to a Spanish-speaking agent.",
  },
  res_dnc: {
    id: "res_dnc",
    title: "DNC request",
    agent:
      "Understood. I'll make sure you're marked as do not contact. Have a good day.",
  },
  res_hangup: {
    id: "res_hangup",
    title: "Hung up immediately",
    agent: "Log the attempt. Do not call back today.",
  },
};

function buildTree(args: {
  key: LeadKind;
  label: string;
  description: string;
  voicemail: string;
  /** Greeting + reason for the call. The opener will append the address-confirm question. */
  greetingText: string;
  greetingHint?: string;
  /** Carrier-ask script shown after the address is confirmed. */
  carrierText: string;
  carrierResponses: ResponseOption[];
}): ScriptTree {
  // First question on every call: confirm we're talking to the right household
  // at the right address. This catches wrong numbers, moves, and DNC early
  // before the agent invests time in a quote.
  const opener: ScriptNode = {
    id: "opener",
    title: "Confirm address",
    agent:
      `${args.greetingText} Before I dive in, I just want to make sure I have the right info — what address are you at these days?`,
    hint:
      args.greetingHint ??
      "Ask open-ended — never 'are you still at [Address]?' which lets them say no and stall. Get them to tell you the address. If it differs from the CRM, update it before quoting — rates and carrier eligibility depend on garaging address.",
    responses: [
      { label: "Same address on file", next: "ask_carrier" },
      { label: "Different / new address", next: "update_address" },
      { label: "Wrong number", next: "res_wrong_number", flag: "wrong_number" },
      { label: "Not the right person", next: "wrong_person_pivot" },
      { label: "Do not call", next: "end_dnc", flag: "dnc" },
      { label: "Busy / call later", next: "obj_busy" },
      { label: "Hung up", next: "end_hangup" },
    ],
  };
  const askCarrier: ScriptNode = {
    id: "ask_carrier",
    title: "Ask current carrier",
    agent: args.carrierText,
    responses: args.carrierResponses,
  };
  const updateAddress: ScriptNode = {
    id: "update_address",
    title: "Update garaging address",
    agent:
      "Got it — let's update that. What's the new street, city, and ZIP? I'll get that in our system before we run the numbers, since the garaging address changes the rate.",
    hint: "Update the lead's address in the CRM, then continue.",
    responses: [
      { label: "Address updated — continue", next: "ask_carrier" },
      { label: "Refuses to share", next: "obj_not_interested" },
      { label: "Busy / call later", next: "obj_busy" },
    ],
  };
  const wrongPersonPivot: ScriptNode = {
    id: "wrong_person_pivot",
    title: "Wrong person — pivot to them",
    agent:
      "Oh, my apologies for the mix-up! While I have you though — since I'm already on the line: who are you currently insured with for your auto? We've been saving folks in Florida a good chunk lately, and it only takes a couple minutes to see if I can do better for you too.",
    hint:
      "Don't waste the conversation — pivot warmly with a getter question (who, not 'would you'). Never give them a yes/no out. If they answer with a carrier, treat them as a new prospect and capture their info.",
    responses: [
      { label: "Sure, let's see — gave carrier", next: "quote_vehicles" },
      { label: "Curious but busy", next: "obj_busy" },
      { label: "Just email me something", next: "obj_just_email" },
      { label: "Already insured — happy with rate", next: "obj_already_insured" },
      { label: "Not interested", next: "obj_not_interested" },
      { label: "Still wrong number — remove", next: "res_wrong_number", flag: "wrong_number" },
      { label: "Do not call", next: "end_dnc", flag: "dnc" },
    ],
  };
  return {
    key: args.key,
    label: args.label,
    description: args.description,
    voicemail: args.voicemail,
    opener,
    nodes: {
      opener,
      ask_carrier: askCarrier,
      update_address: updateAddress,
      wrong_person_pivot: wrongPersonPivot,
      ...sharedObjections,
    },
  };
}

export const CALL_SCRIPTS: Record<LeadKind, ScriptTree> = {
  aged_auto: buildTree({
    key: "aged_auto",
    label: "Aged Auto",
    description: "Older request, prospect may not remember filling anything out.",
    voicemail:
      "Hey [Name], this is Brit Foshee with Anchor Line Insurance. I saw you had checked into auto insurance rates before, and with rates changing again in Florida, we're doing quick reviews to see if there's a better option available. It should only take a few minutes to check. Give me a call back at 239-898-8885. Again, Brit with Anchor Line Insurance, 239-898-8885.",
    greetingText:
      "Hey, is this [Name]? Hey [Name], this is [Agent] with Anchor Line Insurance here in Florida. I know I'm catching you out of the blue, so I'll be brief. It looks like at some point you had checked into auto insurance rates, and we're reviewing older requests because rates have been moving around again in Florida.",
    carrierText:
      "Thanks for confirming. I'm not sure if we can beat what you have, but it only takes a few minutes to check — if it's not better, I'll tell you. Who are you currently insured with?",
    carrierResponses: [
      { label: "Gave carrier", next: "quote_vehicles" },
      { label: "Don't remember filling anything out", next: "obj_already_insured" },
      { label: "Already have insurance", next: "obj_already_insured" },
      { label: "Not interested", next: "obj_not_interested" },
      { label: "Just email me", next: "obj_just_email" },
      { label: "I'm busy", next: "obj_busy" },
      { label: "How did you get my number?", next: "obj_how_got_number" },
      { label: "Call me later", next: "obj_call_later" },
      { label: "Do not call", next: "end_dnc", flag: "dnc" },
      { label: "Wrong number", next: "res_wrong_number", flag: "wrong_number" },
      { label: "Hung up", next: "end_hangup" },
    ],
  }),
  fresh_internet_auto: buildTree({
    key: "fresh_internet_auto",
    label: "Fresh Internet Auto",
    description: "Recent web form submission — respond fast.",
    voicemail:
      "Hey [Name], this is Brit with Anchor Line Insurance. I'm working on the auto insurance quote request you submitted, and it's looking really good so far. I just need to verify a couple of quick things to make sure I'm getting you all the available discounts. Give me a call back at 239-898-8885. Again, Brit with Anchor Line Insurance, 239-898-8885.",
    greetingText:
      "Hey [Name], this is [Agent] with Anchor Line Insurance. I'm following up on the auto insurance quote request you recently submitted, and I'm going to help get this worked up for you.",
    carrierText:
      "Perfect. Let's start with who you're currently insured with.",
    carrierResponses: [
      { label: "Gave carrier", next: "quote_vehicles" },
      { label: "Doesn't remember request", next: "obj_how_got_number" },
      { label: "Already got a quote elsewhere", next: "obj_already_insured" },
      { label: "Just shopping", next: "quote_vehicles" },
      { label: "Wants cheapest option", next: "quote_vehicles" },
      { label: "Busy / call later", next: "obj_busy" },
      { label: "Just email me", next: "obj_just_email" },
      { label: "Not interested", next: "obj_not_interested" },
      { label: "Do not call", next: "end_dnc", flag: "dnc" },
      { label: "Wrong number", next: "res_wrong_number", flag: "wrong_number" },
    ],
  }),
  quote_followup: buildTree({
    key: "quote_followup",
    label: "Quote Follow-Up",
    description: "Quote was already built — present numbers and bind.",
    voicemail:
      "Hey [Name], this is [Agent] with Anchor Line Insurance. I was calling about the insurance quote we worked up for you. I wanted to review the numbers and help you compare it against what you have now. Give me a call back at [Phone]. Again, this is [Agent] with Anchor Line at [Phone].",
    greetingText:
      "Hey [Name], this is [Agent] with Anchor Line Insurance. We had worked up your insurance quote, and I wanted to go over the numbers with you.",
    carrierText:
      "The quote looks worth reviewing, so I'm calling to help you stack it against what you have now. What are you currently paying for your auto?",
    carrierResponses: [
      { label: "Ready to review", next: "qf_present" },
      { label: "Busy / call later", next: "obj_busy" },
      { label: "Just email it", next: "obj_just_email" },
      { label: "Needs spouse", next: "end_callback", flag: "callback" },
      { label: "Price too high", next: "qf_price" },
      { label: "Wants to think about it", next: "qf_think" },
      { label: "Already bought elsewhere", next: "end_not_interested", dispo: "dead" },
      { label: "Staying with current carrier", next: "end_not_interested", dispo: "dead" },
      { label: "Not interested", next: "obj_not_interested" },
      { label: "Do not call", next: "end_dnc", flag: "dnc" },
    ],
  }),
  requote: buildTree({
    key: "requote",
    label: "Requote",
    description: "Previously quoted — rerun and re-pitch.",
    voicemail:
      "Hey [Name], this is Brit with Anchor Line Insurance. We looked at insurance for you before, and I wanted to check back in because things look more competitive now than they did last time. We may have a much better shot at improving your rate this time around. Give me a call back at 239-898-8885. Again, Brit with Anchor Line Insurance, 239-898-8885.",
    greetingText:
      "Hey [Name], this is [Agent] with Anchor Line Insurance. We had looked at insurance options for you before, and I wanted to revisit it because rates and carrier appetite can change.",
    carrierText:
      "It may be worth taking another look to see if there's a better option now. Who's your current carrier these days?",
    carrierResponses: [
      { label: "Open to review", next: "quote_vehicles" },
      { label: "Already bought elsewhere", next: "end_not_interested", dispo: "dead" },
      { label: "Still with current carrier", next: "obj_already_insured" },
      { label: "Busy / call later", next: "obj_busy" },
      { label: "Just email me", next: "obj_just_email" },
      { label: "Asked why calling again", next: "obj_how_got_number" },
      { label: "Not interested", next: "obj_not_interested" },
      { label: "Do not call", next: "end_dnc", flag: "dnc" },
    ],
  }),
};

// Quote Follow-Up specific nodes.
CALL_SCRIPTS.quote_followup.nodes.qf_present = {
  id: "qf_present",
  title: "Present the quote",
  agent:
    "Great. You told me you were paying around $[Current]. This option came back around $[New], depending on final underwriting, with comparable coverage. That's about $[Savings] in monthly savings. At that point, it makes sense to get this switched before your next payment.",
  responses: [
    { label: "Ready to bind", next: "end_bind", flag: "bound", dispo: "sold" },
    { label: "Needs spouse", next: "end_callback", flag: "callback" },
    { label: "Has coverage question", next: "qf_coverage" },
    { label: "Price objection", next: "qf_price" },
    { label: "Wants to think", next: "qf_think" },
    { label: "Wants email only", next: "end_email_only", dispo: "follow_up" },
    { label: "Declines", next: "end_not_interested", dispo: "dead" },
  ],
};
CALL_SCRIPTS.quote_followup.nodes.qf_price = {
  id: "qf_price",
  title: "Price objection",
  agent:
    "Totally understand price matters. Let's compare side-by-side — if the coverage is stronger or the deductible is better, the value may still be there. What's your biggest concern about the number?",
  responses: [
    { label: "Coverage question", next: "qf_coverage" },
    { label: "Wants cheaper", next: "qf_present" },
    { label: "Wants callback", next: "end_callback", flag: "callback" },
    { label: "Declines", next: "end_not_interested", dispo: "dead" },
  ],
};
CALL_SCRIPTS.quote_followup.nodes.qf_coverage = {
  id: "qf_coverage",
  title: "Coverage comparison",
  agent:
    "Let's walk through exactly what's different. I'll line up your current liability, comp/collision, deductibles, and any extras against this quote so it's apples-to-apples.",
  responses: [
    { label: "Ready to bind", next: "end_bind", flag: "bound", dispo: "sold" },
    { label: "Wants to think", next: "qf_think" },
    { label: "Wants callback", next: "end_callback", flag: "callback" },
  ],
};
CALL_SCRIPTS.quote_followup.nodes.qf_think = {
  id: "qf_think",
  title: "Wants to think",
  agent:
    "Of course. Let's make sure you're thinking about the real numbers, not a guess. The main thing is comparing it against what you have now. When's a good time to circle back — later today or tomorrow?",
  responses: [
    { label: "Schedule callback", next: "end_callback", flag: "callback" },
    { label: "Email summary", next: "end_email_only", dispo: "follow_up" },
    { label: "Declines", next: "end_not_interested", dispo: "dead" },
  ],
};
CALL_SCRIPTS.quote_followup.nodes.end_bind = {
  id: "end_bind",
  title: "Bind the policy",
  agent:
    "Perfect — let's lock in the effective date and get the policy issued. I'll walk you through the paperwork now.",
  hint: "Mark the lead as sold and capture premium/carrier on the policy.",
};

// Map the special "non-connected" call results to a starting node id.
export function resultStartNode(result: CallResult): string | null {
  switch (result) {
    case "connected":
      return "opener";
    case "voicemail":
      return null; // voicemail uses tree.voicemail string, no nodes
    case "no_answer":
      return "res_no_answer";
    case "busy":
      return "res_busy";
    case "wrong_number":
      return "res_wrong_number";
    case "bad_number":
      return "res_bad_number";
    case "gatekeeper":
      return "res_gatekeeper";
    case "spouse":
      return "res_spouse";
    case "spanish":
      return "res_spanish";
    case "dnc":
      return "res_dnc";
    case "hangup":
      return "res_hangup";
    default:
      return null;
  }
}

// Bridge the existing SCRIPT_TYPES (auto/home etc) and lead source labels to
// a LeadKind. Falls back to aged_auto so the agent always has a tree.
export function inferLeadKind(input?: {
  scriptType?: string | null;
  listType?: string | null;
  dispo?: string | null;
}): LeadKind {
  const s = (input?.scriptType ?? "").toLowerCase();
  const lt = (input?.listType ?? "").toLowerCase();
  const d = (input?.dispo ?? "").toLowerCase();
  if (d === "quoted" || d === "follow_up") return "quote_followup";
  if (s === "web_lead" || lt.includes("web") || lt.includes("internet"))
    return "fresh_internet_auto";
  if (s === "requote" || lt.includes("requote")) return "requote";
  return "aged_auto";
}