import { useRef, useState, type ReactNode, type MouseEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Phone, Ban } from "lucide-react";
import { insertCallLoggedDeduped } from "@/lib/dedupeActivity";
import { cn } from "@/lib/utils";
import { dispatchCallInitiated } from "@/components/CallOutcomeDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings";
import { SCRIPT_TYPES, type ScriptType } from "@/lib/constants";
import { CallGuide } from "@/components/CallGuide";
import { inferLeadKind } from "@/lib/callScripts";

export const CALL_OUTCOMES: { value: string; label: string }[] = [
  { value: "connected", label: "Connected" },
  { value: "voicemail", label: "Voicemail" },
  { value: "busy", label: "Busy" },
  { value: "no_answer_no_vm", label: "No answer / No VM" },
];

export function callOutcomeLabel(v: unknown): string {
  const s = String(v ?? "");
  if (s === "initiated") return "Call initiated";
  if (s === "no_answer") return "No answer";
  if (s === "no_answer_no_vm") return "No answer / No VM";
  if (s === "connected_sold") return "Answered — Sold";
  if (s === "connected_quoted") return "Answered — Quoted";
  if (s === "connected_follow_up") return "Answered — Follow Up";
  if (s === "connected_not_interested") return "Answered — Not interested";
  if (s === "callback_requested") return "Callback requested";
  return CALL_OUTCOMES.find((o) => o.value === s)?.label ?? s;
}

export function CallButton({
  leadId,
  leadTable,
  phone,
  uid,
  className,
  children,
  stopPropagation = true,
  dnc = false,
  onBeforeCall,
  onOpenLead,
  scriptType,
}: {
  leadId: string;
  leadTable: "leads" | "list_leads";
  phone: string;
  uid: string;
  className?: string;
  children?: ReactNode;
  stopPropagation?: boolean;
  dnc?: boolean;
  onBeforeCall?: () => void;
  /**
   * Override default lead-open behavior. By default, clicking the phone
   * navigates to `/leads/$leadId?source=<leadTable>`. Pass a callback to
   * handle "open the lead" differently (e.g. open an inline editor).
   * Pass `false` to disable.
   */
  onOpenLead?: (() => void) | false;
  /** When provided, a pre-call dialog asks the agent if they want the script. */
  scriptType?: ScriptType;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: settings } = useSettings();
  const [promptOpen, setPromptOpen] = useState(false);
  const [showScript, setShowScript] = useState(false);
  // Debounce rapid double-clicks on the call button so they can't create
  // twin `initiated` rows.
  const lastClickRef = useRef<number>(0);

  const tel = `tel:${phone.replace(/\D/g, "")}`;

  if (dnc) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-sm font-medium w-fit",
          "bg-destructive/10 text-destructive border border-destructive/30 cursor-not-allowed line-through decoration-destructive/60",
          className,
        )}
        title="Do Not Call"
        aria-label={`Do not call ${phone}`}
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation();
        }}
      >
        <Ban className="h-3.5 w-3.5" /> DNC · {phone}
      </span>
    );
  }

  const logInitiated = async () => {
    // Fire-and-forget: ensures the call is counted even if the agent never
    // returns to pick an outcome (common on mobile, where tel: opens dialer).
    const { error, skipped } = await insertCallLoggedDeduped({
      lead_id: leadId,
      lead_table: leadTable,
      user_id: uid,
      outcome: "initiated",
      phone,
    });
    if (!error && !skipped) {
      qc.invalidateQueries({ queryKey: ["lead_activities", leadTable, leadId] });
    }
  };

  const performCall = (opts?: { skipScript?: boolean }) => {
    // Ignore a second invocation within 1.5s — almost always an accidental
    // double-click, not a genuine redial.
    const now = Date.now();
    if (now - lastClickRef.current < 1500) return;
    lastClickRef.current = now;
    try { onBeforeCall?.(); } catch { /* noop */ }
    void logInitiated();
    dispatchCallInitiated({ leadId, leadTable, phone, uid, scriptType, skipScript: opts?.skipScript });
    if (onOpenLead === false) {
      // explicitly disabled
    } else if (typeof onOpenLead === "function") {
      try { onOpenLead(); } catch { /* noop */ }
    } else {
      void navigate({
        to: "/leads/$leadId",
        params: { leadId },
        search: { source: leadTable === "leads" ? "live" : "list" },
      });
    }
    window.location.href = tel;
  };

  const scriptLabel = scriptType
    ? SCRIPT_TYPES.find((t) => t.value === scriptType)?.label ?? scriptType
    : "";
  const leadKind = inferLeadKind({ scriptType });
  // Suppress unused-var lint for settings; legacy static script text is no
  // longer rendered (the guided CallGuide replaces it).
  void settings;

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (stopPropagation) e.stopPropagation();
    if (scriptType) {
      e.preventDefault();
      setShowScript(false);
      setPromptOpen(true);
      return;
    }
    try { onBeforeCall?.(); } catch { /* noop */ }
    void logInitiated();
    dispatchCallInitiated({ leadId, leadTable, phone, uid, scriptType });
    if (onOpenLead === false) {
      // explicitly disabled
    } else if (typeof onOpenLead === "function") {
      try { onOpenLead(); } catch { /* noop */ }
    } else {
      void navigate({
        to: "/leads/$leadId",
        params: { leadId },
        search: { source: leadTable === "leads" ? "live" : "list" },
      });
    }
  };

  return (
    <>
      <a
        href={tel}
        className={cn(
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-sm font-medium text-primary w-fit",
          "bg-primary/10 hover:bg-primary/15 hover:underline underline-offset-2 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          className,
        )}
        onClick={handleClick}
      >
        {children ?? (
          <>
            <Phone className="h-3.5 w-3.5" /> {phone}
          </>
        )}
      </a>
      {scriptType && (
        <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
          <DialogContent className="max-w-xl" onClick={(e) => e.stopPropagation()}>
            <DialogHeader>
              <DialogTitle>Calling {phone}</DialogTitle>
              <DialogDescription>
                Start the call, then use the guide to navigate the {scriptLabel.toLowerCase()} script.
              </DialogDescription>
            </DialogHeader>
            {showScript && (
              <div className="max-h-[60vh] overflow-auto rounded-md border bg-background p-3">
                <CallGuide
                  leadId={leadId}
                  leadTable={leadTable}
                  uid={uid}
                  initialKind={leadKind}
                  onClose={() => {
                    setShowScript(false);
                    setPromptOpen(false);
                  }}
                />
              </div>
            )}
            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                type="button"
                onClick={() => {
                  setShowScript(true);
                  performCall();
                }}
                disabled={showScript}
              >
                <Phone className="mr-1.5 h-4 w-4" /> {showScript ? "Calling…" : "Call with script"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPromptOpen(false);
                  performCall({ skipScript: true });
                }}
                disabled={showScript}
              >
                <Phone className="mr-1.5 h-4 w-4" /> Call without
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}