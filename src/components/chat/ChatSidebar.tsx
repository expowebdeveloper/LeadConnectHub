import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Plus, Hash, Lock, Megaphone, Users as UsersIcon, MessageCircle,
  Search, Smile, Circle, CircleDot, Coffee, Utensils, BellOff, Check, ChevronDown,
} from "lucide-react";
import {
  listMyConversations,
  type ConversationSummary,
} from "@/lib/chat.functions";
import { setMyStatus, type ManualStatus } from "@/lib/admin.functions";
import { subscribeAllConversations } from "@/lib/chat-realtime";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useHasRole } from "@/lib/auth";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { NewConversationDialog, type NewConversationMode } from "./NewConversationDialog";
import { AnnouncementComposer } from "./AnnouncementComposer";
import { CustomStatusDialog } from "./CustomStatusDialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format, isToday, isYesterday } from "date-fns";

const MANUAL_STATUS_OPTIONS: Array<{
  value: ManualStatus | null;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  dot: string;
  minutes?: number;
}> = [
  { value: "available", label: "Available", Icon: CircleDot, dot: "bg-emerald-500" },
  { value: "lunch", label: "Lunch", Icon: Utensils, dot: "bg-amber-400", minutes: 60 },
  { value: "break", label: "Break", Icon: Coffee, dot: "bg-amber-400", minutes: 15 },
  { value: "meeting", label: "Meeting", Icon: UsersIcon, dot: "bg-sky-400", minutes: 60 },
  { value: "dnd", label: "Do not disturb", Icon: BellOff, dot: "bg-rose-500" },
  { value: "offline", label: "Offline", Icon: Circle, dot: "bg-muted-foreground" },
];

function ConvIcon({ c }: { c: ConversationSummary }) {
  if (c.type === "dm") {
    return (
      <div className="shrink-0">
        <AgentAvatar name={c.other_user?.name} path={c.other_user?.avatar} size="md" />
      </div>
    );
  }
  if (c.type === "announcement") {
    return (
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-400">
        <Megaphone className="h-5 w-5" />
      </div>
    );
  }
  if (c.type === "group_dm") {
    return (
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-400">
        <UsersIcon className="h-5 w-5" />
      </div>
    );
  }
  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-chat-accent/15 text-chat-accent">
      {c.is_private ? <Lock className="h-4 w-4" /> : <Hash className="h-5 w-5" />}
    </div>
  );
}

function convLabel(c: ConversationSummary): string {
  if (c.type === "dm") return c.other_user?.name ?? "Direct message";
  if (c.type === "group_dm") return c.name ?? "Group chat";
  return c.name ?? "Channel";
}

function convDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MM/dd/yyyy");
}

export function ChatSidebar({
  selectedConversationId,
  onSelectConversation,
  isPopout = false,
}: {
  selectedConversationId: string | null;
  onSelectConversation: (id: string) => void;
  isPopout?: boolean;
}) {
  const { user, profile } = useAuth();
  const isAdmin = useHasRole("admin");
  const qc = useQueryClient();
  const listConvs = useServerFn(listMyConversations);

  const [search, setSearch] = useState("");
  const [newMode, setNewMode] = useState<NewConversationMode | null>(null);
  const [announceConvId, setAnnounceConvId] = useState<string | null>(null);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [customStatusOpen, setCustomStatusOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "unread" | "channels">("all");

  const convsQ = useQuery({
    queryKey: ["chat.conversations"],
    queryFn: () => listConvs(),
    enabled: !!user,
    refetchOnWindowFocus: true,
  });

  const myStatusQ = useQuery({
    queryKey: ["my_manual_status", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("manual_status, manual_status_until")
        .eq("id", user!.id)
        .maybeSingle();
      const until = data?.manual_status_until ? new Date(data.manual_status_until).getTime() : 0;
      if (until && until <= Date.now()) return null;
      return (data?.manual_status as ManualStatus | null) ?? null;
    },
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!user) return;
    const off = subscribeAllConversations(() => {
      qc.invalidateQueries({ queryKey: ["chat.conversations"] });
    });
    return () => {
      off();
    };
  }, [user, qc]);

  const conversations = convsQ.data?.conversations ?? [];

  const announcements = conversations.filter((c) => c.type === "announcement");
  const channels = conversations.filter((c) => c.type === "channel");

  const q = search.trim().toLowerCase();
  const sorted = useMemo(() => {
    const base = [...conversations].sort((a, b) => {
      const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return tb - ta;
    });
    let filtered = base;
    if (tab === "unread") filtered = filtered.filter((c) => c.unread_count > 0);
    else if (tab === "channels") filtered = filtered.filter((c) => c.type === "channel" || c.type === "announcement");
    if (q) filtered = filtered.filter((c) => convLabel(c).toLowerCase().includes(q));
    return filtered;
  }, [conversations, tab, q]);

  const updateStatus = async (s: ManualStatus | null) => {
    const opt = MANUAL_STATUS_OPTIONS.find((o) => o.value === s);
    try {
      await setMyStatus({ data: { status: s, minutes: opt?.minutes } });
      qc.invalidateQueries({ queryKey: ["my_manual_status", user?.id] });
      qc.invalidateQueries({ queryKey: ["team_presence"] });
      toast.success(s ? `Status set to ${opt?.label}` : "Status cleared");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update status");
    }
  };

  const myStatus = myStatusQ.data ?? null;
  const currentStatusOpt = MANUAL_STATUS_OPTIONS.find((o) => o.value === myStatus);

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-r border-sidebar-border/60 bg-chat-sidebar text-sidebar-foreground md:w-[360px]">
      {/* MY STATUS */}
      <div className="border-b border-sidebar-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent/60"
            >
              <div className="relative">
                <AgentAvatar name={profile?.full_name ?? user?.email} path={profile?.avatar_url} size="sm" />
                <span className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-sidebar",
                  currentStatusOpt?.dot ?? "bg-emerald-500",
                )} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold">
                  {profile?.full_name || user?.email}
                </div>
                <div className="truncate text-[10.5px] text-sidebar-foreground/60">
                  {currentStatusOpt?.label ?? "Active"}
                </div>
              </div>
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
              Set your status
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => updateStatus(null)}>
              <Check className={cn("mr-2 h-3.5 w-3.5", myStatus === null ? "opacity-100" : "opacity-0")} />
              Clear (auto)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {MANUAL_STATUS_OPTIONS.map((o) => (
              <DropdownMenuItem key={o.value ?? "none"} onSelect={() => updateStatus(o.value)}>
                <span className={cn("mr-2 inline-block h-2.5 w-2.5 rounded-full", o.dot)} />
                <o.Icon className="mr-2 h-3.5 w-3.5" />
                {o.label}
                {myStatus === o.value && <Check className="ml-auto h-3.5 w-3.5" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setCustomStatusOpen(true)}>
              <Smile className="mr-2 h-3.5 w-3.5" />
              Custom status…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* SEARCH + NEW */}
      <div className="space-y-2 border-b border-sidebar-border px-3 pb-3 pt-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground/40" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats & people…"
              className="h-9 rounded-lg border-sidebar-border/60 bg-sidebar-accent/40 pl-8 text-xs text-sidebar-foreground placeholder:text-sidebar-foreground/40 focus-visible:ring-chat-accent/40"
            />
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="group flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-chat-accent text-[12.5px] font-semibold text-chat-accent-foreground shadow-sm transition-all hover:brightness-110 active:scale-[0.99]"
            >
              <Plus className="h-4 w-4" />
              New
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onSelect={() => setNewMode("dm")}>
              <MessageCircle className="mr-2 h-4 w-4 text-chat-accent" />
              Direct message
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setNewMode("group")}>
              <UsersIcon className="mr-2 h-4 w-4 text-chat-accent" />
              Group chat
            </DropdownMenuItem>
            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setNewMode("channel")}>
                  <Hash className="mr-2 h-4 w-4 text-chat-accent" />
                  Channel
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    const target = announcements[0] ?? channels.find((c) => c.name === "general");
                    if (!target) {
                      toast.error("Create an announcement channel first");
                      return;
                    }
                    setAnnounceConvId(target.id);
                    setAnnounceOpen(true);
                  }}
                >
                  <Megaphone className="mr-2 h-4 w-4 text-amber-400" />
                  Announcement
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* FILTER TABS */}
      <div className="flex items-center gap-1.5 border-b border-sidebar-border px-3 py-2">
        {(["all", "unread", "channels"] as const).map((t) => {
          const label = t === "all" ? "All" : t === "unread" ? "Unread" : "Channels";
          const count = t === "unread" ? conversations.reduce((s, c) => s + (c.unread_count > 0 ? 1 : 0), 0) : 0;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "flex h-7 items-center gap-1 rounded-full px-3 text-[12px] font-semibold transition-colors",
                tab === t
                  ? "bg-chat-accent text-chat-accent-foreground"
                  : "bg-sidebar-accent/40 text-sidebar-foreground/70 hover:bg-sidebar-accent/60",
              )}
            >
              {label}
              {count > 0 && t === "unread" && (
                <span className={cn(
                  "rounded-full px-1.5 text-[10px] font-bold leading-tight",
                  tab === t ? "bg-chat-accent-foreground/20" : "bg-chat-accent/20 text-chat-accent",
                )}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-0.5 px-2 py-2">
          {sorted.length === 0 && (
            <div className="px-3 py-6 text-center text-[12px] text-sidebar-foreground/40">
              {tab === "unread" ? "Nothing unread" : q ? "No matches" : "No conversations yet"}
            </div>
          )}
          {sorted.map((c) => (
            <ConvRow
              key={c.id}
              c={c}
              active={c.id === selectedConversationId}
              onClick={() => onSelectConversation(c.id)}
            />
          ))}
        </div>
      </ScrollArea>

      <NewConversationDialog
        open={newMode !== null}
        initialMode={newMode ?? "dm"}
        allowChannel={isAdmin}
        onClose={() => setNewMode(null)}
        onCreated={(id) => {
          setNewMode(null);
          qc.invalidateQueries({ queryKey: ["chat.conversations"] });
          onSelectConversation(id);
        }}
      />

      {announceConvId && (
        <AnnouncementComposer
          open={announceOpen}
          onClose={() => setAnnounceOpen(false)}
          conversationId={announceConvId}
          onPosted={() => {
            setAnnounceOpen(false);
            qc.invalidateQueries({ queryKey: ["chat.conversations"] });
          }}
        />
      )}

      <CustomStatusDialog
        open={customStatusOpen}
        onClose={() => setCustomStatusOpen(false)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["chat.teammates_with_status"] });
        }}
      />
    </aside>
  );
}

function ConvRow({ c, active, onClick }: { c: ConversationSummary; active: boolean; onClick: () => void }) {
  const date = convDate(c.last_message_at);
  const preview = c.last_message_preview?.replace(/\s+/g, " ").trim() || "No messages yet";
  const unread = c.unread_count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors",
        active
          ? "bg-sidebar-accent/60 text-sidebar-accent-foreground"
          : "hover:bg-sidebar-accent/30",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-r bg-chat-accent transition-opacity",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <ConvIcon c={c} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn(
            "truncate text-[14px] leading-tight",
            unread ? "font-bold text-sidebar-foreground" : "font-semibold text-sidebar-foreground/90",
          )}>
            {convLabel(c)}
          </span>
        </div>
        <div className={cn(
          "mt-0.5 truncate text-[12px] leading-snug",
          unread ? "text-sidebar-foreground/85" : "text-sidebar-foreground/55",
        )}>
          {preview}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        {date && (
          <span className={cn(
            "shrink-0 text-[11px] tabular-nums",
            unread ? "font-semibold text-chat-accent" : "text-sidebar-foreground/45",
          )}>
            {date}
          </span>
        )}
        {unread && (
          <span className="rounded-full bg-chat-accent px-1.5 py-0.5 text-[10px] font-bold leading-none text-chat-accent-foreground">
            {c.unread_count}
          </span>
        )}
      </div>
    </button>
  );
}