import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { insertCallLoggedDeduped } from "@/lib/dedupeActivity";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CALL_OUTCOMES } from "@/components/CallButton";
import { CallGuide } from "@/components/CallGuide";
import { inferLeadKind } from "@/lib/callScripts";
import { PostCallEmailPrompt, type PostCallEmailRequest } from "@/components/PostCallEmailPrompt";
import { canCloseLead } from "@/lib/closeGuard";
import { useAuth } from "@/lib/auth";

export type CallInitiatedPayload = {
  leadId: string;
  leadTable: "leads" | "list_leads";
  phone: string;
  uid: string;
  scriptType?: string | null;
  /** Agent picked "Call without" — never auto-open the script/guide for this call. */
  skipScript?: boolean;
};

export const CALL_INITIATED_EVENT = "leadvault:call-initiated";

export function dispatchCallInitiated(payload: CallInitiatedPayload) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CALL_INITIATED_EVENT, { detail: payload }));
}

/**
 * Global "How did the call end?" dialog. Mounted once at the root so it
 * survives route changes — clicking a phone number can navigate to the lead
 * detail page without unmounting the outcome prompt.
 */
export function CallOutcomeDialog() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const [payload, setPayload] = useState<CallInitiatedPayload | null>(null);
  const [saving, setSaving] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideResult, setGuideResult] = useState<"connected" | "voicemail">("connected");
  const [emailReq, setEmailReq] = useState<PostCallEmailRequest | null>(null);

  // Block dismissing the outcome dialog / live script until the agent has
  // finished disposing the lead (dispo + notes, plus quoted premium when
  // the dispo implies a quote was given). Without this, an agent can pick
  // a dispo via the script and then close the dialog with Esc/click-outside
  // and leave the lead in a half-worked state — which also keeps the team
  // presence strip showing them "On call" until activity ages out.
  const guardedClose = async (next: () => void) => {
    if (!payload) return next();
    const ok = await canCloseLead(payload.leadTable, payload.leadId, payload.uid, isAdmin);
    if (ok) next();
  };

  const promptEmail = (
    outcome: "voicemail" | "busy" | "no_answer_no_vm" | "connected",
    p: CallInitiatedPayload,
  ) => {
    setEmailReq({ outcome, leadId: p.leadId, leadTable: p.leadTable });
    // After a connected call, drop the agent on the lead workspace so they
    // can't sneak off without entering premium / dispo. The email prompt
    // still renders on top — this just stages the right page underneath.
    if (outcome === "connected") {
      navigate({
        to: "/my-leads",
        search: { openLead: `${p.leadTable}:${p.leadId}` },
      });
    }
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<CallInitiatedPayload>;
      if (!ce.detail) return;
      setPayload((prev) => {
        const sameLead =
          prev &&
          prev.leadId === ce.detail.leadId &&
          prev.leadTable === ce.detail.leadTable;
        // Only reset the live guide when switching to a different lead.
        // Redialing the same lead should keep their info on screen so the
        // agent is ready the moment the prospect picks up.
        if (!sameLead) setGuideOpen(false);
        return ce.detail;
      });
    };
    window.addEventListener(CALL_INITIATED_EVENT, handler);
    return () => window.removeEventListener(CALL_INITIATED_EVENT, handler);
  }, []);

  const log = async (outcome: string) => {
    if (!payload) return;
    // "Answered" is a live-call event — open the AI guide instead of
    // closing out the call. The guide logs its own activities; we only
    // log the answered fact here.
    if (outcome === "connected") {
      void insertCallLoggedDeduped({
        lead_id: payload.leadId,
        lead_table: payload.leadTable,
        user_id: payload.uid,
        outcome,
        phone: payload.phone,
      }).then(({ error, skipped }) => {
        if (!error && !skipped) {
          qc.invalidateQueries({ queryKey: ["lead_activities", payload.leadTable, payload.leadId] });
        }
      });
      // No auto-claim on connect: shark-tank dialing is hunting. The lead
      // only locks to this agent when they explicitly claim it or save
      // real work (dispo / notes / etc.) in the workspace.
      if (payload.skipScript) {
        toast.success("Call logged");
        const cur = payload;
        setPayload(null);
        promptEmail("connected", cur);
        return;
      }
      setGuideResult("connected");
      setGuideOpen(true);
      return;
    }
    // Voicemail logs the call and opens the VM script. It does NOT claim the
    // lead — the lead stays in the shark tank but drops to 0% via the
    // no-connect trigger and recovers 1%/day from the VM timestamp.
    if (outcome === "voicemail") {
      void insertCallLoggedDeduped({
        lead_id: payload.leadId,
        lead_table: payload.leadTable,
        user_id: payload.uid,
        outcome,
        phone: payload.phone,
      }).then(({ error, skipped }) => {
        if (!error && !skipped) {
          qc.invalidateQueries({ queryKey: ["lead_activities", payload.leadTable, payload.leadId] });
          qc.invalidateQueries({ queryKey: ["list_leads"] });
          qc.invalidateQueries({ queryKey: ["leads"] });
        }
      });
      if (payload.skipScript) {
        toast.success("Voicemail logged");
        const cur = payload;
        setPayload(null);
        promptEmail("voicemail", cur);
        return;
      }
      setGuideResult("voicemail");
      setGuideOpen(true);
      return;
    }
    setSaving(true);
    const { error } = await insertCallLoggedDeduped({
      lead_id: payload.leadId,
      lead_table: payload.leadTable,
      user_id: payload.uid,
      outcome,
      phone: payload.phone,
    });
    if (error) {
      setSaving(false);
      toast.error(error.message || "Failed to log call");
      return;
    }
    // No-contact outcomes (voicemail, busy, no answer) should NOT lock the
    // lead to this agent. If we auto-claimed on call start and no dispo has
    // been set yet, release the claim so the lead stays in the shark tank.
    if (
      outcome === "busy" ||
      outcome === "no_answer" ||
      outcome === "no_answer_no_vm"
    ) {
      const { data: cur } = await supabase
        .from(payload.leadTable)
        .select(
          "claimed_by,dispo,agent_notes,quoted_premium,follow_up_at,x_date," +
            "home_claimed_by,home_dispo,home_agent_notes,home_quoted_premium,home_follow_up_at,home_x_date",
        )
        .eq("id", payload.leadId)
        .maybeSingle();
      if (cur) {
        const updates: Record<string, unknown> = {};
        const c = cur as unknown as Record<string, unknown>;
        const cc = cur as unknown as { claimed_by: string | null; home_claimed_by: string | null };
        const autoWorked =
          !!c.dispo ||
          (typeof c.agent_notes === "string" && c.agent_notes.trim().length > 0) ||
          c.quoted_premium != null ||
          c.follow_up_at != null ||
          c.x_date != null;
        const homeWorked =
          !!c.home_dispo ||
          (typeof c.home_agent_notes === "string" && (c.home_agent_notes as string).trim().length > 0) ||
          c.home_quoted_premium != null ||
          c.home_follow_up_at != null ||
          c.home_x_date != null;
        if (cc.claimed_by === payload.uid && !autoWorked) {
          updates.claimed_by = null;
          updates.claimed_at = null;
          if (payload.leadTable === "list_leads") updates.agent_id = null;
        }
        if (cc.home_claimed_by === payload.uid && !homeWorked) {
          updates.home_claimed_by = null;
          updates.home_claimed_at = null;
        }
        if (Object.keys(updates).length > 0) {
          await supabase
            .from(payload.leadTable)
            .update(updates as never)
            .eq("id", payload.leadId);
          qc.invalidateQueries({ queryKey: ["list_leads"] });
          qc.invalidateQueries({ queryKey: ["leads"] });
        }
      }
    }
    setSaving(false);
    toast.success("Call logged");
    qc.invalidateQueries({ queryKey: ["lead_activities", payload.leadTable, payload.leadId] });
    const cur = payload;
    setPayload(null);
    if (outcome === "busy" || outcome === "no_answer_no_vm") {
      promptEmail(outcome, cur);
    }
  };

  const leadKind = inferLeadKind({ scriptType: payload?.scriptType ?? null });

  return (
    <>
    <Dialog
      open={payload !== null}
      onOpenChange={(o) => {
        if (saving || o) return;
        void guardedClose(() => setPayload(null));
      }}
    >
      <DialogContent
        className={guideOpen ? "max-w-2xl" : "max-w-md"}
        onClick={(e) => e.stopPropagation()}
        onInteractOutside={(e) => {
          e.preventDefault();
          void guardedClose(() => setPayload(null));
        }}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          void guardedClose(() => setPayload(null));
        }}
      >
        {!guideOpen && (
          <>
            <DialogHeader>
              <DialogTitle>What's happening on the call?</DialogTitle>
              <DialogDescription>
                {payload
                  ? `Calling ${payload.phone} — tap what's happening right now. Pick "Connected" to open the live script.`
                  : null}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CALL_OUTCOMES.map((o) => (
                <Button
                  key={o.value}
                  variant={o.value === "connected" ? "default" : "outline"}
                  className="justify-start"
                  disabled={saving}
                  onClick={() => log(o.value)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </>
        )}
        {guideOpen && payload && (
          <>
            <DialogHeader>
              <DialogTitle>Live call script</DialogTitle>
              <DialogDescription>
                Follow the prompts and tap the prospect's response to navigate the script.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[70vh] overflow-auto">
              <CallGuide
                leadId={payload.leadId}
                leadTable={payload.leadTable}
                uid={payload.uid}
                initialKind={leadKind}
                initialResult={guideResult}
                onClose={() => {
                  void guardedClose(() => {
                    setGuideOpen(false);
                    const cur = payload;
                    setPayload(null);
                    if (cur) promptEmail(guideResult === "voicemail" ? "voicemail" : "connected", cur);
                  });
                }}
              />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
    <PostCallEmailPrompt request={emailReq} onClose={() => setEmailReq(null)} />
    </>
  );
}