import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence } from "framer-motion";
import { useState } from "react";
import { SharedLeadAlertCard, playSharedLeadSound, type SharedLeadAlertItem } from "@/components/LeadShareAlertsListener";
import { FollowUpDueAlertCard, playFollowUpSound, type FollowUpDueAlertItem } from "@/components/FollowUpDueAlertsListener";
import { LiveLeadAlertCard, playLiveLeadSound, type LiveLeadAlertItem } from "@/components/LiveLeadAlertsListener";

export const Route = createFileRoute("/dev/alert-preview")({
  component: AlertPreviewPage,
});

function makeShared(): SharedLeadAlertItem {
  return {
    shareId: `demo-share-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    leadId: "demo-lead",
    leadTable: "leads",
    lineId: "auto",
    lineLabel: "Auto",
    fullName: "Marcus Johnson",
    phone: "5125550182",
    cityState: "",
    zip: null,
    numVehicles: null,
    currentCarrier: null,
    composite: null,
    tier: null,
    createdAt: new Date().toISOString(),
    sharerName: "Jordan Reyes",
    sharerAvatar: null,
    _status: "open",
  };
}

function makeLive(): LiveLeadAlertItem {
  return {
    id: `test-live-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    first_name: "Priya",
    last_name: "Patel",
    phone: "4155550199",
    city: null,
    state: null,
    zip: null,
    num_vehicles: null,
    current_carrier: null,
    composite_score: 142,
    score_tier: "S",
    claimed_by: null,
    archived_at: null,
    created_at: new Date().toISOString(),
    vendor_id: "demo-vendor",
    vendor_name: "Acme Leads Co.",
    _status: "open",
  };
}

function makeFollowUp(): FollowUpDueAlertItem {
  const key = `demo-fu-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    key,
    leadId: key,
    leadTable: "leads",
    side: "home",
    fullName: "Taylor Brooks",
    phone: "3055550144",
    dueAt: new Date().toISOString(),
  };
}

function AlertPreviewPage() {
  const [shared, setShared] = useState<SharedLeadAlertItem[]>(() => [makeShared()]);
  const [live, setLive] = useState<LiveLeadAlertItem[]>(() => [makeLive()]);
  const [followUps, setFollowUps] = useState<FollowUpDueAlertItem[]>(() => [makeFollowUp()]);

  const addShared = () => {
    playSharedLeadSound();
    setShared((p) => [makeShared(), ...p].slice(0, 20));
  };
  const addLive = () => {
    playLiveLeadSound();
    setLive((p) => [makeLive(), ...p].slice(0, 20));
  };
  const addFollowUp = () => {
    playFollowUpSound();
    setFollowUps((p) => [makeFollowUp(), ...p].slice(0, 20));
  };
  const reset = () => {
    setShared([makeShared()]);
    setLive([makeLive()]);
    setFollowUps([makeFollowUp()]);
  };

  return (
    <div className="min-h-screen bg-slate-950 p-8 text-slate-200">
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold text-white">Alert preview</h1>
        <p className="text-sm text-slate-400">
          All in-app alert styles, mock data only. Alerts stack horizontally and wrap upward.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={addShared}
            className="rounded bg-[#F5FF3A] px-3 py-1.5 text-xs font-bold text-[#020617] hover:opacity-90"
          >
            Add shared-lead alert
          </button>
          <button
            onClick={addLive}
            className="rounded bg-emerald-400 px-3 py-1.5 text-xs font-bold text-[#020617] hover:opacity-90"
          >
            Add live-lead alert
          </button>
          <button
            onClick={addFollowUp}
            className="rounded bg-[#FBBF24] px-3 py-1.5 text-xs font-bold text-[#020617] hover:opacity-90"
          >
            Add follow-up alert
          </button>
          <button
            onClick={reset}
            className="rounded border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            Reset
          </button>
        </div>
        <div className="rounded border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-500">
          Alerts render fixed to the bottom of the viewport — same as production.
        </div>
      </div>

      <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-50 flex flex-row-reverse flex-wrap-reverse items-start content-start gap-2">
        <AnimatePresence initial={false}>
          {shared.map((item) => (
            <SharedLeadAlertCard
              key={item.shareId}
              item={item}
              onClaim={() => setShared((p) => p.filter((a) => a.shareId !== item.shareId))}
              onDismiss={() => setShared((p) => p.filter((a) => a.shareId !== item.shareId))}
            />
          ))}
          {live.map((lead) => (
            <LiveLeadAlertCard
              key={lead.id}
              lead={lead}
              onClaim={() => setLive((p) => p.filter((a) => a.id !== lead.id))}
              onDismiss={() => setLive((p) => p.filter((a) => a.id !== lead.id))}
            />
          ))}
          {followUps.map((item) => (
            <FollowUpDueAlertCard
              key={item.key}
              item={item}
              onOpen={() => setFollowUps((p) => p.filter((a) => a.key !== item.key))}
              onDismiss={() => setFollowUps((p) => p.filter((a) => a.key !== item.key))}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}