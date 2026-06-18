import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, Clock, User } from "lucide-react";
import { getVendorLeadClaimStatus } from "@/lib/vendor-lead-claim.functions";
import { supabase } from "@/integrations/supabase/client";

const WAIT_TIMEOUT_MS = 5 * 60_000; // 5 minutes — claims often take 1–4 min
const POLL_MS = 2_000;

export function VendorLeadWaitDialog({
  leadId,
  open,
  onClose,
}: {
  leadId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const fetchStatus = useServerFn(getVendorLeadClaimStatus);
  const [agent, setAgent] = useState<{ full_name: string | null; email: string | null; avatar_url: string | null } | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (!open || !leadId) return;
    let cancelled = false;
    setAgent(null);
    setTimedOut(false);
    setElapsed(0);
    startRef.current = Date.now();

    const tick = async () => {
      try {
        const res = await fetchStatus({ data: { leadId } });
        if (cancelled) return;
        if (res.claimedBy && res.agent) {
          setAgent(res.agent);
          return; // stop polling once claimed
        }
      } catch {
        // ignore transient errors, keep polling
      }
      if (cancelled) return;
      const e = Date.now() - startRef.current;
      setElapsed(e);
      if (e >= WAIT_TIMEOUT_MS) {
        setTimedOut(true);
        return;
      }
      setTimeout(tick, POLL_MS);
    };
    tick();

    const ui = setInterval(() => {
      if (!cancelled) setElapsed(Date.now() - startRef.current);
    }, 500);

    // Realtime: react the instant the lead row is claimed, instead of waiting
    // up to POLL_MS for the next poll.
    const channel = supabase
      .channel(`lead-claim-${leadId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "leads", filter: `id=eq.${leadId}` },
        (payload) => {
          const next = (payload.new ?? {}) as { claimed_by?: string | null };
          if (next.claimed_by && !cancelled) {
            // Fetch full agent details via the server fn (avoids exposing
            // joined profile fields through realtime payload).
            fetchStatus({ data: { leadId } })
              .then((res) => {
                if (cancelled) return;
                if (res.claimedBy && res.agent) setAgent(res.agent);
              })
              .catch(() => {});
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(ui);
      supabase.removeChannel(channel);
    };
  }, [open, leadId, fetchStatus]);

  const secondsLeft = Math.max(0, Math.ceil((WAIT_TIMEOUT_MS - elapsed) / 1000));
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const claimed = !!agent;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {claimed ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                Agent ready — transfer now
              </>
            ) : timedOut ? (
              <>
                <Clock className="h-5 w-5 text-amber-500" />
                No agent available yet
              </>
            ) : (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Waiting for an agent to claim…
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {claimed
              ? "Stay on the line with your caller and warm-transfer them to the agent below."
              : timedOut
                ? "No agent has claimed this lead yet. You can keep waiting or close this window — the lead remains submitted."
                : "Please keep your caller on hold while we connect a sales agent."}
          </DialogDescription>
        </DialogHeader>

        {claimed ? (
          <div className="flex flex-col items-center gap-4 rounded-lg border bg-muted/40 p-6 text-center">
            {agent?.avatar_url ? (
              <img
                src={agent.avatar_url}
                alt={agent?.full_name || "Agent"}
                className="h-16 w-16 rounded-full object-cover ring-2 ring-emerald-500"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 ring-2 ring-emerald-500">
                <User className="h-8 w-8 text-primary" />
              </div>
            )}
            <div>
              <div className="text-base font-semibold">
                {agent?.full_name || agent?.email || "Sales agent"}
              </div>
              <div className="text-sm text-emerald-600 font-medium mt-1">
                Ready for transfer
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-6">
            {!timedOut && (
              <>
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  {mm}:{ss} remaining — please hold the caller…
                </p>
              </>
            )}
            {timedOut && (
              <Button
                variant="outline"
                onClick={() => {
                  setTimedOut(false);
                  setElapsed(0);
                  startRef.current = Date.now();
                  // re-trigger polling by toggling effect through onClose? simpler: poll once manually
                  fetchStatus({ data: { leadId: leadId! } })
                    .then((res) => {
                      if (res.claimedBy && res.agent) setAgent(res.agent);
                      else {
                        // restart wait window
                        const restart = () => {
                          fetchStatus({ data: { leadId: leadId! } }).then((r) => {
                            if (r.claimedBy && r.agent) setAgent(r.agent);
                          }).catch(() => {});
                        };
                        const id = setInterval(restart, POLL_MS);
                        setTimeout(() => clearInterval(id), WAIT_TIMEOUT_MS);
                      }
                    })
                    .catch(() => {});
                }}
              >
                Keep waiting another 60s
              </Button>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {claimed ? "Done" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}