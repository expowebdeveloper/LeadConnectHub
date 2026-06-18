import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { listTeamPresence, setMyStatus, type PresenceStatus, type ManualStatus } from "@/lib/admin.functions";
import { createDM, listMyConversations, type ConversationSummary } from "@/lib/chat.functions";
import { supabase } from "@/integrations/supabase/client";
import { AgentAvatar, type AgentStatus } from "@/components/AgentAvatar";
import { Phone, Coffee, Utensils, Users, BellOff, Circle, CircleDot, ChevronRight, Waves, X, SquarePen, Activity, Hash, Lock, Megaphone, Eye } from "lucide-react";
import { useAuth, useHasRole } from "@/lib/auth";
import { useAlertPrefs } from "@/components/AlertPrefsSection";
import { useServerFn } from "@tanstack/react-start";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { toast } from "sonner";
import { useIdleAutoStatus } from "@/hooks/useIdleAutoStatus";
import { chatBubbles, useChatBubbles } from "@/hooks/useChatBubbles";
import { NewConversationDialog } from "@/components/chat/NewConversationDialog";
import { ChatBubbleWindow } from "@/components/chat/ChatBubbleWindow";

const STATUS_LABEL: Record<PresenceStatus, string> = {
  on_call: "On call",
  in_tank: "In the tank",
  available: "Available",
  meeting: "In meeting",
  lunch: "Lunch",
  break: "On break",
  dnd: "Do not disturb",
  idle: "Idle",
  offline: "Offline",
};

function StatusIcon({ status, className }: { status: PresenceStatus; className?: string }) {
  const cls = className ?? "h-2.5 w-2.5";
  switch (status) {
    case "on_call":
      return <Phone className={cls} />;
    case "in_tank":
      return <Waves className={cls} />;
    case "available":
      return <CircleDot className={cls} />;
    case "meeting":
      return <Users className={cls} />;
    case "lunch":
      return <Utensils className={cls} />;
    case "break":
      return <Coffee className={cls} />;
    case "dnd":
      return <BellOff className={cls} />;
    default:
      return <Circle className={cls} />;
  }
}

const STATUS_DOT: Record<PresenceStatus, string> = {
  on_call: "bg-emerald-500 text-emerald-50",
  in_tank: "bg-cyan-400 text-cyan-950",
  available: "bg-emerald-500 text-emerald-950",
  meeting: "bg-sky-400 text-sky-950",
  lunch: "bg-amber-400 text-amber-950",
  break: "bg-amber-400 text-amber-950",
  dnd: "bg-rose-500 text-rose-50",
  idle: "bg-zinc-400 text-zinc-950",
  offline: "bg-muted text-muted-foreground",
};

const STATUS_PILL: Record<PresenceStatus, string> = {
  on_call: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/60",
  in_tank: "bg-cyan-500/15 text-cyan-300 ring-cyan-500/60",
  available: "bg-emerald-50 text-emerald-700 ring-emerald-200/60",
  meeting: "bg-sky-50 text-sky-700 ring-sky-200/60",
  lunch: "bg-amber-50 text-amber-700 ring-amber-200/60",
  break: "bg-amber-50 text-amber-700 ring-amber-200/60",
  dnd: "bg-rose-50 text-rose-700 ring-rose-200/60",
  idle: "bg-zinc-100 text-zinc-700 ring-zinc-300/60",
  offline: "bg-muted text-muted-foreground ring-border",
};

const STATUS_PICKER: { value: ManualStatus; label: string; icon: React.ReactNode; color: string }[] = [
  { value: "lunch", label: "Lunch", icon: <Utensils className="h-3.5 w-3.5" />, color: "text-amber-600" },
];

function StatusPicker({
  currentStatus,
  onSelect,
  onClear,
}: {
  currentStatus: PresenceStatus;
  onSelect: (s: ManualStatus) => void;
  onClear: () => void;
}) {
  return (
      <div className="flex flex-col">
      {STATUS_PICKER.map((opt) => {
        const active = currentStatus === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent ${
              active ? "bg-accent/60 font-medium" : ""
            }`}
          >
            <span className={opt.color}>{opt.icon}</span>
            <span className="flex-1 text-left">{opt.label}</span>
          </button>
        );
      })}
      {currentStatus !== "available" && currentStatus !== "on_call" && currentStatus !== "in_tank" && (
        <>
          <div className="my-1 h-px bg-border/60" />
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">Clear status</span>
          </button>
        </>
      )}
    </div>
  );
}

export function TeamPresenceStrip() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const onChatRoute = useRouterState({
    select: (s) => s.location.pathname.startsWith("/team-chat"),
  });
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const isSales = useHasRole("sales");
  const isAdmin = useHasRole("admin");
  const isVendor = useHasRole("vendor");
  const canSee = isSales || isAdmin || isVendor;
  const canNavigate = isSales || isAdmin;
  const { data: prefs } = useAlertPrefs();
  const enabled = canSee && (prefs?.team_presence_visible ?? true);
  const { user } = useAuth();
  const myId = user?.id ?? null;

  // Auto-mark this agent idle after N minutes of inactivity.
  useIdleAutoStatus((isSales || isAdmin) && !!myId);

  const doSetStatus = useServerFn(setMyStatus);
  const doCreateDM = useServerFn(createDM);
  const statusM = useMutation({
    mutationFn: async ({ status, note }: { status: ManualStatus | null; note?: string }) => {
      await doSetStatus({ data: { status, note } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team_presence"] });
      toast.success("Status updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update status"),
  });

  const dmM = useMutation({
    mutationFn: async (otherUserId: string) => {
      const res = await doCreateDM({ data: { otherUserId } });
      return { id: res.id, otherUserId };
    },
    onSuccess: ({ id, otherUserId }) => {
      setOpen(false);
      setHover(false);
      chatBubbles.openBubble(id, { unhideUserId: otherUserId });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Can't message this teammate"),
  });

  const { bubbles, activeId, compose, hiddenTeammates } = useChatBubbles();
  const hiddenSet = new Set(hiddenTeammates);

  const convQ = useQuery({
    queryKey: ["chat.conversations"],
    queryFn: () => listMyConversations(),
    enabled: canSee,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const allConvs: ConversationSummary[] = convQ.data?.conversations ?? [];
  // Map DM-other-user → conversation, for unread badges on teammate avatars.
  const dmByUser = new Map<string, ConversationSummary>();
  for (const c of allConvs) {
    if (c.type === "dm" && c.other_user?.id) dmByUser.set(c.other_user.id, c);
  }
  // Extra rail bubbles: open conversations that are NOT a DM with a listed teammate.
  const extraBubbles = bubbles
    .map((id) => allConvs.find((c) => c.id === id))
    .filter((c): c is ConversationSummary => !!c && c.type !== "dm");

  const presenceQ = useQuery({
    queryKey: ["team_presence"],
    queryFn: () => listTeamPresence(),
    refetchInterval: 30_000,
    staleTime: 15_000,
    enabled,
  });

  // Live updates whenever any agent's status / activity changes.
  useEffect(() => {
    if (!enabled) return;
    const ch = supabase
      .channel("team-presence")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        () => {
          qc.invalidateQueries({ queryKey: ["team_presence"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads" },
        () => {
          qc.invalidateQueries({ queryKey: ["team_presence"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lead_activities" },
        () => {
          qc.invalidateQueries({ queryKey: ["team_presence"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [qc, enabled]);

  // Track which agents are currently on the Shark Tank page via realtime presence.
  const [inTank, setInTank] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!enabled) return;
    // The Shark Tank route also opens this channel to broadcast its own
    // presence. supabase-js returns the same channel object for the same
    // topic on the same client, so if that channel is already subscribed,
    // calling `.on("presence", ...)` here throws and crashes the route.
    // Reuse the existing channel when present; only wire handlers + subscribe
    // when we created it fresh.
    const existing = supabase
      .getChannels()
      .find((c) => c.topic === "realtime:shark-tank-room");
    const ch = existing ?? supabase.channel("shark-tank-room");
    const ownsChannel = !existing;
    const sync = () => {
      const state = ch.presenceState() as Record<string, Array<{ user_id?: string }>>;
      const ids = new Set<string>();
      for (const key of Object.keys(state)) {
        ids.add(key);
        for (const meta of state[key] ?? []) {
          if (meta?.user_id) ids.add(meta.user_id);
        }
      }
      setInTank(ids);
    };
    if (ownsChannel) {
      ch.on("presence", { event: "sync" }, sync)
        .on("presence", { event: "join" }, sync)
        .on("presence", { event: "leave" }, sync)
        .subscribe();
    }
    // Always poll presenceState as a backup so we stay in sync whether or
    // not we own the channel handlers.
    sync();
    const poll = setInterval(sync, 3000);
    return () => {
      clearInterval(poll);
      if (ownsChannel) void supabase.removeChannel(ch);
    };
  }, [enabled]);

  if (!enabled || onChatRoute) return null;
  const rawRows = presenceQ.data ?? [];
  // Overlay "in_tank" on any agent currently present on the Shark Tank page,
  // unless they're on a call (on_call takes precedence).
  const rows = rawRows.map((r) =>
    inTank.has(r.id) && r.status !== "on_call"
      ? { ...r, status: "in_tank" as PresenceStatus }
      : r,
  );
  if (rows.length === 0) return null;

  const onCallCount = rows.filter((r) => r.status === "on_call").length;
  const availableCount = rows.filter((r) => r.status === "available").length;
  const onlineCount = rows.filter((r) => r.status !== "offline").length;

  // Sort: on_call → available → meeting → break/lunch → dnd → offline
  const priority: Record<PresenceStatus, number> = {
    on_call: 0,
    in_tank: 1,
    available: 2,
    meeting: 3,
    lunch: 4,
    break: 4,
    dnd: 5,
    idle: 5,
    offline: 6,
  };
  const sorted = [...rows].sort(
    (a, b) => priority[a.status] - priority[b.status],
  );
  // Show every teammate in the peek strip, top to bottom — minus user-hidden ones (own avatar always shown).
  const peekAvatars = sorted.filter((r) => r.id === myId || !hiddenSet.has(r.id));
  const hiddenCount = sorted.filter((r) => r.id !== myId && hiddenSet.has(r.id)).length;

  // Hover/focus opens the panel; clicking the tab pins it open.
  const isOpen = open || hover;

  return (
    <div
      className="relative z-40 hidden h-full min-h-0 w-auto md:block"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex h-full min-h-0 flex-row items-end">
        {/* Always-visible peek rail on the left edge — bubbles + compose */}
        <div className="group relative flex h-full min-h-0 w-12 sm:w-14 flex-col items-center gap-2.5 overflow-y-auto overflow-x-visible rounded-tr-xl border-t border-r border-border bg-card px-1 py-3 sm:py-3.5 shadow-md">
          {/* Compose bubble — first in rail */}
          <button
            type="button"
            onClick={() => chatBubbles.openCompose("dm")}
            className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm ring-2 ring-card transition-transform hover:scale-110"
            aria-label="New message"
            title="New message"
          >
            <SquarePen className="h-4 w-4" />
          </button>

          {peekAvatars.map((r) => {
            const display = r.full_name || r.email || "Unknown";
            const isMe = r.id === myId;
            const dmConv = dmByUser.get(r.id);
            const isActive = !!dmConv && activeId === dmConv.id;
            const unread = dmConv?.unread_count ?? 0;
            const avatar = (
              <AgentAvatar
                name={display}
                path={r.avatar_url}
                size="md"
                className={isActive ? "ring-2 ring-primary" : "ring-2 ring-card"}
              />
            );
            const statusDot = (
              <span
                className={`absolute -bottom-0.5 -right-0.5 block h-2.5 w-2.5 rounded-full ring-2 ring-card ${STATUS_DOT[r.status]}`}
                aria-hidden
              />
            );
            const unreadBadge = unread > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white ring-2 ring-card">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null;
            return (
              <span key={r.id} className="relative group/bub" title={`${display} — ${STATUS_LABEL[r.status]}`}>
                {isMe ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="relative block">
                        {avatar}
                        {statusDot}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="right" align="center" sideOffset={6} className="w-36 p-1">
                      <StatusPicker
                        currentStatus={r.status}
                        onSelect={(s) => statusM.mutate({ status: s })}
                        onClear={() => statusM.mutate({ status: null })}
                      />
                    </PopoverContent>
                  </Popover>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (isActive) {
                        chatBubbles.setActive(null);
                      } else if (dmConv) {
                        chatBubbles.openBubble(dmConv.id);
                      } else {
                        dmM.mutate(r.id);
                      }
                    }}
                    disabled={dmM.isPending}
                    className="relative block transition-transform hover:scale-110"
                    aria-label={`Message ${display}`}
                  >
                    {avatar}
                    {statusDot}
                    {unreadBadge}
                  </button>
                )}
                {!isMe && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (dmConv) chatBubbles.closeBubble(dmConv.id);
                      chatBubbles.hideTeammate(r.id);
                    }}
                    className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-muted text-muted-foreground shadow ring-1 ring-border hover:bg-accent hover:text-foreground group-hover/bub:flex"
                    aria-label={`Hide ${display} from rail`}
                    title="Hide from rail"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </span>
            );
          })}

          {/* Extra (non-DM) chat bubbles in the rail */}
          {extraBubbles.map((c) => {
            const isActive = activeId === c.id;
            const unread = c.unread_count ?? 0;
            const label = c.name ?? (c.type === "group_dm" ? "Group" : "Channel");
            return (
              <span key={c.id} className="relative group/bub" title={label}>
                <button
                  type="button"
                  onClick={() => chatBubbles.setActive(isActive ? null : c.id)}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground shadow-sm ring-2 transition-transform hover:scale-110 ${isActive ? "ring-primary" : "ring-card"}`}
                  aria-label={`Open ${label}`}
                >
                  {c.type === "announcement" ? (
                    <Megaphone className="h-4 w-4 text-amber-500" />
                  ) : c.is_private ? (
                    <Lock className="h-4 w-4" />
                  ) : (
                    <Hash className="h-4 w-4" />
                  )}
                  {unread > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white ring-2 ring-card">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    chatBubbles.closeBubble(c.id);
                  }}
                  className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-muted text-muted-foreground shadow ring-1 ring-border hover:bg-accent hover:text-foreground group-hover/bub:flex"
                  aria-label="Close bubble"
                  title="Close"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            );
          })}

          {/* Chevron toggle for the slide-out panel */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-auto rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={isOpen ? "Hide who's working" : "Show who's working"}
            aria-expanded={isOpen}
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isOpen ? "" : "rotate-180"}`} />
          </button>
        </div>

        {/* Slide-out panel */}
        <div
          className={`overflow-hidden transition-[width,opacity] duration-200 ${
            isOpen ? "w-72 opacity-100" : "w-0 opacity-0"
          }`}
          aria-hidden={!isOpen}
        >
          <div className="ml-[-1px] flex max-h-[calc(100vh-1rem)] w-72 flex-col rounded-r-2xl border border-l-0 border-border bg-card shadow-[12px_0_40px_-15px_rgba(0,0,0,0.18)]">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Who's working</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {onlineCount}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-muted-foreground">
                  {onCallCount} on call · {availableCount} avail
                </span>
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => chatBubbles.clearHidden()}
                    className="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title="Show all hidden teammates"
                  >
                    Show {hiddenCount} hidden
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setHover(false);
                    chatBubbles.openCompose("dm");
                  }}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="New message"
                  title="New message"
                >
                  <SquarePen className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {sorted.map((r) => {
                const display = r.full_name || r.email || "Unknown";
                const muted =
                  r.status === "offline" ||
                  r.status === "lunch" ||
                  r.status === "break";
                const isMe = r.id === myId;
                const isHidden = !isMe && hiddenSet.has(r.id);
                return (
                  <div
                    key={r.id}
                    className={`group flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors ${canNavigate ? "hover:bg-accent/60" : ""} ${muted || isHidden ? "opacity-75" : ""}`}
                  >
                    {isMe ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" className="relative shrink-0 cursor-pointer">
                            <AgentAvatar
                              name={display}
                              path={r.avatar_url}
                              size="md"
                              status={r.status as AgentStatus}
                            />
                            {r.status === "on_call" ? (
                              <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-2 ring-card">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                              </span>
                            ) : (
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-2 ring-card ${STATUS_DOT[r.status]}`}
                              >
                                <StatusIcon status={r.status} className="h-2 w-2" />
                              </span>
                            )}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent side="right" align="center" sideOffset={6} className="w-36 p-1">
                          <StatusPicker
                            currentStatus={r.status}
                            onSelect={(s) => statusM.mutate({ status: s })}
                            onClear={() => statusM.mutate({ status: null })}
                          />
                        </PopoverContent>
                      </Popover>
                    ) : (
                      <span className="relative shrink-0">
                        <AgentAvatar
                          name={display}
                          path={r.avatar_url}
                          size="md"
                          status={r.status as AgentStatus}
                        />
                        {r.status === "on_call" ? (
                          <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-2 ring-card">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                          </span>
                        ) : (
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-2 ring-card ${STATUS_DOT[r.status]}`}
                          >
                            <StatusIcon status={r.status} className="h-2 w-2" />
                          </span>
                        )}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (isMe) return;
                        dmM.mutate(r.id);
                      }}
                      disabled={isMe || dmM.isPending}
                      className={`min-w-0 flex-1 text-left ${isMe ? "cursor-default" : "cursor-pointer"}`}
                      title={isMe ? undefined : `Message ${display}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {display}
                        </p>
                        {r.status === "on_call" ? (
                          <span
                            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/60 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300"
                            title="Agent is on a call — waiting for disposition"
                          >
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            </span>
                            On call
                          </span>
                        ) : (
                          <span
                            className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${STATUS_PILL[r.status]}`}
                          >
                            {STATUS_LABEL[r.status]}
                          </span>
                        )}
                      </div>
                      {r.manual_status_note ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {r.manual_status_note}
                        </p>
                      ) : null}
                    </button>
                    {canNavigate && !isMe && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(false);
                          setHover(false);
                          navigate({
                            to: "/agents/$agentId/activity",
                            params: { agentId: r.id },
                          });
                        }}
                        className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                        aria-label={`View ${display}'s activity`}
                        title="View activity"
                      >
                        <Activity className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {!isMe && isHidden && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          chatBubbles.showTeammate(r.id);
                        }}
                        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        aria-label={`Show ${display} on rail`}
                        title="Show on rail"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Floating chat window for the active bubble */}
      {activeId && <ChatBubbleWindow conversationId={activeId} />}

      {/* Compose / new conversation dialog */}
      <NewConversationDialog
        open={compose !== null}
        initialMode={compose ?? "dm"}
        onClose={() => chatBubbles.closeCompose()}
        onCreated={(id, meta) => {
          chatBubbles.closeCompose();
          chatBubbles.openBubble(
            id,
            meta?.type === "dm" && meta.dmUserId ? { unhideUserId: meta.dmUserId } : undefined,
          );
          qc.invalidateQueries({ queryKey: ["chat.conversations"] });
        }}
      />
    </div>
  );
}