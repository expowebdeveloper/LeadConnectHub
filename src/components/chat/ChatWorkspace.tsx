import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listMyConversations,
  getConversation,
  listMessages,
  sendMessage,
  toggleReaction,
  markRead,
  searchTeammates,
  createDM,
  createChannel,
  createAttachmentUploadUrl,
  getLeadPreview,
  pinMessage,
  deleteMessage,
  setPresence,
  editMessage,
  type ConversationSummary,
} from "@/lib/chat.functions";
import {
  listMyMentions,
  markMentionsRead,
  ackAnnouncement,
  searchMessages,
  getThreadCounts,
} from "@/lib/chat-stage2.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  subscribeConversation,
  subscribeAllConversations,
  subscribePresence,
  broadcastTyping,
} from "@/lib/chat-realtime";
import { useAuth, useHasRole } from "@/lib/auth";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Hash, Lock, Plus, Send, Search, Paperclip, Smile, AtSign, Megaphone,
  Pin, Trash2, MessageSquare, MoreVertical, Users as UsersIcon, X, Info, FileText, Image as ImageIcon,
  Mic, Reply, Pencil, Check, CheckCheck, Settings, Shield, Smile as SmileIcon, ExternalLink, ArrowLeft,
} from "lucide-react";
import { formatDistanceToNow, format, isToday, isYesterday } from "date-fns";
import { useBrowserNotifications } from "@/hooks/useBrowserNotifications";
import { useIsMobile } from "@/hooks/use-mobile";
import { ThreadPanel } from "./ThreadPanel";
import { MentionAutocomplete, type MentionPick } from "./MentionAutocomplete";
import { CustomStatusDialog } from "./CustomStatusDialog";
import { AnnouncementComposer } from "./AnnouncementComposer";
import { GifPicker } from "./GifPicker";
import { VoiceRecorder } from "./VoiceRecorder";
import { NewConversationDialog, type NewConversationMode } from "./NewConversationDialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { shareLeadToConversation } from "@/lib/chat-stage2.functions";
import { TaskFromMessageDialog } from "./TaskFromMessageDialog";
import { MessageMoreMenu } from "./MessageMoreMenu";
import { SlashCommandMenu, type SlashCommandId } from "./SlashCommandMenu";
import { TemplatePicker } from "./TemplatePicker";
import { AIPopover } from "./AIPopover";
import { GlobalSearchDialog } from "./GlobalSearchDialog";
import { RelatedLeadsSection } from "./RelatedLeadsSection";
import { PinnedMessagesSection } from "./PinnedMessagesSection";
import { TasksSection } from "./TasksSection";
import { useChatHotkeys } from "@/hooks/useChatHotkeys";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles } from "lucide-react";

const COMMON_EMOJIS = ["👍", "🔥", "🎉", "💯", "👀", "✅", "❤️", "😂", "🤝", "👏"];

function formatDuration(seconds: number) {
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return `Yesterday ${format(d, "h:mm a")}`;
  return format(d, "MMM d, h:mm a");
}

function relativeTime(iso: string | null) {
  if (!iso) return "";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: false })
      .replace("about ", "")
      .replace("less than a minute", "now")
      .replace(" minutes", "m")
      .replace(" minute", "m")
      .replace(" hours", "h")
      .replace(" hour", "h")
      .replace(" days", "d")
      .replace(" day", "d")
      .replace(" months", "mo")
      .replace(" month", "mo");
  } catch {
    return "";
  }
}

function ConversationIcon({ c }: { c: ConversationSummary }) {
  if (c.type === "dm") {
    return <AgentAvatar name={c.other_user?.name} size="sm" />;
  }
  if (c.type === "announcement") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded text-amber-400">
        <Megaphone className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center text-muted-foreground">
      {c.is_private ? <Lock className="h-3 w-3" /> : <Hash className="h-3.5 w-3.5" />}
    </span>
  );
}

function conversationLabel(c: ConversationSummary): string {
  if (c.type === "dm") return c.other_user?.name ?? "Direct message";
  if (c.type === "group_dm") return c.name ?? "Group chat";
  return c.name ?? "Channel";
}

export function ChatWorkspace({ initialConversationId, compact = false, onOpenFull, hideSidebar = false, selectedConversationId, onSelectConversation, isPopout = false }: {
  initialConversationId?: string | null;
  compact?: boolean;
  onOpenFull?: () => void;
  hideSidebar?: boolean;
  selectedConversationId?: string | null;
  onSelectConversation?: (id: string | null) => void;
  isPopout?: boolean;
}) {
  const { user, profile } = useAuth();
  const isMobile = useIsMobile();
  const isAdmin = useHasRole("admin");
  const qc = useQueryClient();
  const list = useServerFn(listMyConversations);
  const fetchConv = useServerFn(getConversation);
  const fetchMsgs = useServerFn(listMessages);
  const send = useServerFn(sendMessage);
  const reactFn = useServerFn(toggleReaction);
  const markReadFn = useServerFn(markRead);
  const searchUsers = useServerFn(searchTeammates);
  const newDM = useServerFn(createDM);
  const newChannel = useServerFn(createChannel);
  const uploadUrl = useServerFn(createAttachmentUploadUrl);
  const leadPrev = useServerFn(getLeadPreview);
  const pinFn = useServerFn(pinMessage);
  const delFn = useServerFn(deleteMessage);
  const presenceFn = useServerFn(setPresence);

  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(initialConversationId ?? null);
  const isControlled = selectedConversationId !== undefined;
  const selectedId = isControlled ? selectedConversationId ?? null : internalSelectedId;
  const setSelectedId = (id: string | null) => {
    if (isControlled) {
      onSelectConversation?.(id);
    } else {
      setInternalSelectedId(id);
    }
  };
  const [newMsgOpen, setNewMsgOpen] = useState(false);
  const [newChanOpen, setNewChanOpen] = useState(false);
  const [newConvMode, setNewConvMode] = useState<NewConversationMode | null>(null);
  const [search, setSearch] = useState("");
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Map<string, { name: string; at: number }>>(new Map());
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [latestMsgSig, setLatestMsgSig] = useState<{ title: string; body: string; conversationId?: string } | null>(null);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [taskDialog, setTaskDialog] = useState<{ open: boolean; messageId?: string | null; leadId?: string | null; initialTitle?: string; initialDescription?: string }>({ open: false });
  const [panelRefresh, setPanelRefresh] = useState(0);
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(null);
  const [composerInsert, setComposerInsert] = useState<string | null>(null);

  const editFn = useServerFn(editMessage);
  const ackFn = useServerFn(ackAnnouncement);
  const mentionsFn = useServerFn(listMyMentions);
  const markMentionsReadFn = useServerFn(markMentionsRead);
  const searchMsgsFn = useServerFn(searchMessages);
  const threadCountsFn = useServerFn(getThreadCounts);

  // Deep-link: read ?c= conversation id from URL on first mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const c = params.get("c");
    if (c && !initialConversationId) setSelectedId(c);
    const compose = params.get("compose");
    if (compose === "dm" || compose === "group" || compose === "channel") {
      setNewConvMode(compose);
      // Strip the param so reloads don't re-open it.
      params.delete("compose");
      const qs = params.toString();
      const url = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
      window.history.replaceState({}, "", url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Presence heartbeat: mark online while mounted
  useEffect(() => {
    if (!user) return;
    void presenceFn({ data: { status: "online" } }).catch(() => {});
    const id = window.setInterval(() => {
      void presenceFn({ data: { status: "online" } }).catch(() => {});
    }, 60_000);
    const onUnload = () => {
      void presenceFn({ data: { status: "offline" } }).catch(() => {});
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("beforeunload", onUnload);
      void presenceFn({ data: { status: "offline" } }).catch(() => {});
    };
  }, [user?.id]);

  // Conversation list
  const convsQ = useQuery({
    queryKey: ["chat.conversations"],
    queryFn: () => list(),
    refetchOnWindowFocus: true,
  });

  const conversations = convsQ.data?.conversations ?? [];
  const totalUnread = conversations.reduce((s, c) => s + c.unread_count, 0);

  // Mentions count (drives red dot)
  const mentionsQ = useQuery({
    queryKey: ["chat.mentions.unread"],
    queryFn: () => mentionsFn(),
    refetchInterval: 30_000,
  });
  const unreadMentions = mentionsQ.data?.unread ?? 0;

  // Auto-select first conversation
  useEffect(() => {
    if (isControlled) return;
    if (!selectedId && conversations.length) {
      // prefer general
      const general = conversations.find((c) => c.name === "general");
      setSelectedId(general?.id ?? conversations[0].id);
    }
  }, [conversations, isControlled, selectedId]);

  // Global subscription: refetch list on any change
  useEffect(() => {
    const off = subscribeAllConversations(() => {
      qc.invalidateQueries({ queryKey: ["chat.conversations"] });
    });
    const off2 = subscribePresence(() => {
      qc.invalidateQueries({ queryKey: ["chat.conversation", selectedId] });
    });
    return () => {
      off();
      off2();
    };
  }, [qc, selectedId]);

  // Selected conversation data
  const convQ = useQuery({
    queryKey: ["chat.conversation", selectedId],
    queryFn: () => (selectedId ? fetchConv({ data: { conversationId: selectedId } }) : Promise.resolve(null)),
    enabled: !!selectedId,
  });
  const msgsQ = useQuery({
    queryKey: ["chat.messages", selectedId],
    queryFn: () => (selectedId ? fetchMsgs({ data: { conversationId: selectedId } }) : Promise.resolve(null)),
    enabled: !!selectedId,
  });

  // Per-conversation realtime
  useEffect(() => {
    if (!selectedId) return;
    const off = subscribeConversation({
      conversationId: selectedId,
      onMessageChange: () => {
        qc.invalidateQueries({ queryKey: ["chat.messages", selectedId] });
        qc.invalidateQueries({ queryKey: ["chat.conversations"] });
      },
      onReactionChange: () => {
        qc.invalidateQueries({ queryKey: ["chat.messages", selectedId] });
      },
      onTyping: (uid, name) => {
        if (uid === user?.id) return;
        setTypingUsers((prev) => {
          const next = new Map(prev);
          next.set(uid, { name, at: Date.now() });
          return next;
        });
      },
    });
    return off;
  }, [selectedId, qc, user?.id]);

  // Prune typing indicators
  useEffect(() => {
    const id = window.setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now();
        const next = new Map(prev);
        for (const [k, v] of next) {
          if (now - v.at > 4000) next.delete(k);
        }
        return next;
      });
    }, 1500);
    return () => window.clearInterval(id);
  }, []);

  // Mark read whenever selection changes / new messages arrive
  useEffect(() => {
    if (!selectedId) return;
    void markReadFn({ data: { conversationId: selectedId } })
      .then(() => qc.invalidateQueries({ queryKey: ["chat.conversations"] }))
      .catch(() => {});
  }, [selectedId, msgsQ.data]);

  // Browser tab title for global unread
  useBrowserNotifications({
    unreadCount: totalUnread,
    title: "Team Chat — LeadVault",
    onNewMessage: latestMsgSig,
  });

  const selected = convQ.data?.conversation;
  const members = convQ.data?.members ?? [];
  const messages = msgsQ.data?.messages ?? [];

  // Thread reply counts
  const threadCountsQ = useQuery({
    queryKey: ["chat.thread-counts", selectedId, messages.map((m) => m.id).join(",")],
    queryFn: () => threadCountsFn({ data: { messageIds: messages.filter((m) => !m.parent_message_id).map((m) => m.id) } }),
    enabled: messages.length > 0,
  });
  const threadCounts = threadCountsQ.data?.counts ?? {};

  // Track latest incoming message to fire notification
  const lastSeenMsgIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!messages.length) return;
    const last = messages[messages.length - 1];
    if (lastSeenMsgIdRef.current === null) {
      lastSeenMsgIdRef.current = last.id;
      return;
    }
    if (last.id !== lastSeenMsgIdRef.current && last.sender_id !== user?.id) {
      lastSeenMsgIdRef.current = last.id;
      setLatestMsgSig({
        title: selected?.name ? `# ${selected.name} · ${last.sender_name}` : last.sender_name,
        body: last.body?.slice(0, 140) ?? "(new message)",
        conversationId: selectedId ?? undefined,
      });
    } else {
      lastSeenMsgIdRef.current = last.id;
    }
  }, [messages, user?.id, selected?.name, selectedId]);

  // Mark mentions read whenever you open a conversation
  useEffect(() => {
    if (!selectedId) return;
    void markMentionsReadFn({ data: { conversationId: selectedId } })
      .then(() => qc.invalidateQueries({ queryKey: ["chat.mentions.unread"] }))
      .catch(() => {});
  }, [selectedId]);

  const channels = conversations.filter((c) => c.type === "channel");
  const announcements = conversations.filter((c) => c.type === "announcement");
  const dms = conversations.filter((c) => c.type === "dm" || c.type === "group_dm");

  const filtered = (arr: ConversationSummary[]) =>
    !search.trim()
      ? arr
      : arr.filter((c) =>
          conversationLabel(c).toLowerCase().includes(search.trim().toLowerCase()),
        );

  // Detect the first linked lead from messages for CRM hover actions.
  const linkedLeadId = useMemo(() => {
    for (const m of messages) {
      const match = m.body?.match(/\/leads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (match) return match[1];
    }
    return null;
  }, [messages]);

  useChatHotkeys({
    onSearch: () => setGlobalSearchOpen(true),
    onNew: () => setNewConvMode("dm"),
    onEscape: () => {
      if (globalSearchOpen) setGlobalSearchOpen(false);
      else if (threadParentId) setThreadParentId(null);
      else if (showRightPanel) setShowRightPanel(false);
    },
  });

  return (
    <div className={cn("flex h-full w-full overflow-hidden bg-sidebar text-sidebar-foreground", compact && "h-full")}>
      {/* LEFT SIDEBAR */}
      <aside className={cn("flex w-64 shrink-0 flex-col border-r border-sidebar-border", (compact || hideSidebar) && "hidden")}>
        <div className="border-b border-sidebar-border p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight">
              <MessageSquare className="h-4 w-4 text-sidebar-primary" />
              Chat Vault
              {unreadMentions > 0 && (
                <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
                  @{unreadMentions}
                </span>
              )}
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
                onClick={() => setStatusOpen(true)}
                title="Set status"
              >
                <SmileIcon className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
                onClick={() => setSearchOpen(true)}
                title="Search messages"
              >
                <Search className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
                onClick={() => setNewConvMode("dm")}
                title="New direct message"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="relative mt-3">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground/40" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setGlobalSearchOpen(true)}
              placeholder="Search messages, people, files, or leads…"
              className="h-8 border-sidebar-border bg-sidebar-accent/40 pl-7 pr-10 text-xs text-sidebar-foreground placeholder:text-sidebar-foreground/40"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-sidebar-border bg-sidebar-accent/40 px-1 text-[9px] font-semibold text-sidebar-foreground/50">
              ⌘K
            </span>
          </div>
          <Button
            onClick={() => setNewConvMode("dm")}
            className="mt-2 h-8 w-full justify-center gap-1.5 text-xs"
            size="sm"
          >
            <Plus className="h-3.5 w-3.5" />
            New conversation
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2">
            <SidebarSection title="Announcements" icon={<Megaphone className="h-3 w-3" />}>
              {filtered(announcements).map((c) => (
                <ConversationRow key={c.id} c={c} active={c.id === selectedId} onClick={() => setSelectedId(c.id)} />
              ))}
            </SidebarSection>

            <SidebarSection
              title="Channels"
              right={
                <button
                  className="text-sidebar-foreground/50 hover:text-sidebar-foreground"
                  onClick={() => setNewConvMode("channel")}
                  title="Create channel"
                >
                  <Plus className="h-3 w-3" />
                </button>
              }
            >
              {filtered(channels).map((c) => (
                <ConversationRow key={c.id} c={c} active={c.id === selectedId} onClick={() => setSelectedId(c.id)} />
              ))}
              {filtered(channels).length === 0 && (
                <div className="px-2 py-1 text-[11px] text-sidebar-foreground/40">No channels</div>
              )}
            </SidebarSection>

            <SidebarSection
              title="Direct Messages"
              right={
                <button
                  className="text-sidebar-foreground/50 hover:text-sidebar-foreground"
                  onClick={() => setNewConvMode("dm")}
                  title="New DM"
                >
                  <Plus className="h-3 w-3" />
                </button>
              }
            >
              {filtered(dms).map((c) => (
                <ConversationRow key={c.id} c={c} active={c.id === selectedId} onClick={() => setSelectedId(c.id)} />
              ))}
              {filtered(dms).length === 0 && (
                <div className="px-2 py-1 text-[11px] text-sidebar-foreground/40">
                  No DMs yet. Click "New conversation" to start one.
                </div>
              )}
            </SidebarSection>
          </div>
        </ScrollArea>
        <div className="border-t border-sidebar-border p-2">
          <a
            href="/team-chat/admin"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-sidebar-foreground/60 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
          >
            <Shield className="h-3 w-3" />
            Admin
          </a>
        </div>
      </aside>

      {/* CENTER: thread */}
      <main className="flex flex-1 flex-col overflow-hidden bg-background text-foreground">
        {selected ? (
          <>
            <ChannelHeader
              title={
                selected.type === "dm"
                  ? conversations.find((c) => c.id === selected.id)?.other_user?.name ?? "Direct message"
                  : `# ${selected.name ?? "channel"}`
              }
              subtitle={
                selected.type === "dm"
                  ? undefined
                  : `${members.length} ${members.length === 1 ? "member" : "members"}`
              }
              avatarUrl={
                selected.type === "dm"
                  ? conversations.find((c) => c.id === selected.id)?.other_user?.avatar ?? null
                  : null
              }
              avatarName={
                selected.type === "dm"
                  ? conversations.find((c) => c.id === selected.id)?.other_user?.name ?? null
                  : null
              }
              onToggleDetails={() => setShowRightPanel((v) => !v)}
              detailsOpen={showRightPanel}
              isAnnouncement={selected.type === "announcement" && isAdmin}
              onPostAnnouncement={() => setAnnounceOpen(true)}
              conversationId={selectedId ?? undefined}
              onDraftReply={(text) => setComposerInsert(text)}
              onCreateTaskFromAI={(title, description) =>
                setTaskDialog({ open: true, leadId: linkedLeadId, initialTitle: title, initialDescription: description })
              }
              isPopout={isPopout}
              compact={compact}
              onBack={onSelectConversation ? () => onSelectConversation(null) : undefined}
            />
            <MessageList
              messages={messages}
              currentUserId={user?.id ?? ""}
              threadCounts={threadCounts}
              compact={compact}
              isDM={selected.type === "dm"}
              linkedLeadId={linkedLeadId}
              jumpToMessageId={jumpToMessageId}
              onJumped={() => setJumpToMessageId(null)}
              onMessageCreateTask={(mid, body) => setTaskDialog({ open: true, messageId: mid, leadId: linkedLeadId, initialTitle: (body ?? "").slice(0, 120) })}
              onReact={async (mid, emoji) => {
                await reactFn({ data: { messageId: mid, emoji } });
                qc.invalidateQueries({ queryKey: ["chat.messages", selectedId] });
              }}
              onPin={async (mid) => {
                if (!selectedId) return;
                await pinFn({ data: { messageId: mid, conversationId: selectedId, pin: true } });
                qc.invalidateQueries({ queryKey: ["chat.conversation", selectedId] });
                setPanelRefresh((x) => x + 1);
                toast.success("Pinned");
              }}
              onDelete={async (mid) => {
                const key = ["chat.messages", selectedId] as const;
                const prev = qc.getQueryData<{ messages: Array<{ id: string; deleted_at: string | null; body: string | null }>; has_more: boolean } | null>(key);
                qc.setQueryData(key, (data: typeof prev) => {
                  if (!data?.messages) return data;
                  return {
                    ...data,
                    messages: data.messages.filter((m) => m.id !== mid),
                  };
                });
                try {
                  await delFn({ data: { messageId: mid } });
                } catch (e) {
                  qc.setQueryData(key, prev);
                  toast.error(e instanceof Error ? e.message : "Failed to delete");
                }
              }}
              onReply={(mid) => setThreadParentId(mid)}
              onEdit={async (mid, body) => {
                await editFn({ data: { messageId: mid, body } });
                qc.invalidateQueries({ queryKey: ["chat.messages", selectedId] });
                setEditingId(null);
              }}
              onAck={async (mid) => {
                await ackFn({ data: { messageId: mid } });
                qc.invalidateQueries({ queryKey: ["chat.messages", selectedId] });
                qc.invalidateQueries({ queryKey: ["chat.mentions.unread"] });
                toast.success("Acknowledged");
              }}
              editingId={editingId}
              setEditingId={setEditingId}
              getLeadPreview={async (id) => (await leadPrev({ data: { leadId: id } })).lead}
            />
            <TypingIndicator names={Array.from(typingUsers.values()).map((v) => v.name)} />
            <Composer
              conversationId={selectedId!}
              compact={compact}
              insert={composerInsert}
              onInsertConsumed={() => setComposerInsert(null)}
              linkedLeadId={linkedLeadId}
              onSlashTask={() => setTaskDialog({ open: true, leadId: linkedLeadId })}
              onSend={async (body, attachments, mentionUserIds, mentionEveryone) => {
                if (!selectedId) return;
                await send({
                  data: {
                    conversationId: selectedId,
                    body,
                    attachments,
                    mentionUserIds,
                    mentionEveryone,
                  },
                });
                qc.invalidateQueries({ queryKey: ["chat.messages", selectedId] });
                qc.invalidateQueries({ queryKey: ["chat.conversations"] });
              }}
              onTyping={() => {
                if (!selectedId || !user) return;
                broadcastTyping(selectedId, user.id, profile?.full_name ?? user.email ?? "Someone");
              }}
              onRequestUploadUrl={async (fileName) => {
                if (!selectedId) throw new Error("No conversation");
                return uploadUrl({ data: { conversationId: selectedId, fileName } });
              }}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center bg-chat-body/40 px-6">
            <div className="max-w-sm rounded-2xl border border-border/60 bg-card/40 px-8 py-10 text-center shadow-sm">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-chat-accent/15 text-chat-accent">
                <MessageSquare className="h-6 w-6" />
              </div>
              <div className="text-sm font-semibold">Pick a conversation</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Choose a chat from the sidebar, or hit <span className="font-medium text-chat-accent">+ New</span> to start one.
              </div>
            </div>
          </div>
        )}
      </main>

      {/* RIGHT panel: thread takes priority, otherwise details */}
      {threadParentId && selectedId && !compact ? (
        <ThreadPanel
          parentMessageId={threadParentId}
          conversationId={selectedId}
          onClose={() => setThreadParentId(null)}
        />
      ) : showRightPanel && selected && !compact ? (
        <DetailsPanel
          conversation={selected}
          members={members}
          messages={messages}
          onClose={() => setShowRightPanel(false)}
          refreshKey={panelRefresh}
          linkedLeadId={linkedLeadId}
          onJumpToMessage={(mid) => setJumpToMessageId(mid)}
          onNewTask={() => setTaskDialog({ open: true, leadId: linkedLeadId })}
          onCreateTaskForLead={(lid) => setTaskDialog({ open: true, leadId: lid })}
        />
      ) : null}

      {/* New message dialog */}
      <NewMessageDialog
        open={newMsgOpen}
        onClose={() => setNewMsgOpen(false)}
        onPick={async (uid) => {
          setNewMsgOpen(false);
          try {
            const { id } = await newDM({ data: { otherUserId: uid } });
            qc.invalidateQueries({ queryKey: ["chat.conversations"] });
            setSelectedId(id);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to start DM");
          }
        }}
        search={async (q) => (await searchUsers({ data: { q } })).users}
      />

      <NewChannelDialog
        open={newChanOpen}
        onClose={() => setNewChanOpen(false)}
        onCreate={async (name, isPrivate) => {
          try {
            const { id } = await newChannel({ data: { name, isPrivate } });
            qc.invalidateQueries({ queryKey: ["chat.conversations"] });
            setSelectedId(id);
            setNewChanOpen(false);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to create channel");
          }
        }}
      />

      <NewConversationDialog
        open={newConvMode !== null}
        initialMode={newConvMode ?? "dm"}
        allowChannel={isAdmin}
        onClose={() => setNewConvMode(null)}
        onCreated={(id) => {
          setNewConvMode(null);
          qc.invalidateQueries({ queryKey: ["chat.conversations"] });
          setSelectedId(id);
        }}
      />

      {onOpenFull && compact && (
        <button
          className="fixed bottom-3 right-3 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg"
          onClick={onOpenFull}
        >
          Open Full Chat ↗
        </button>
      )}

      <CustomStatusDialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        onSaved={() => qc.invalidateQueries({ queryKey: ["chat.conversation", selectedId] })}
      />

      {selectedId && (
        <AnnouncementComposer
          open={announceOpen}
          onClose={() => setAnnounceOpen(false)}
          conversationId={selectedId}
          onPosted={() => {
            qc.invalidateQueries({ queryKey: ["chat.messages", selectedId] });
            qc.invalidateQueries({ queryKey: ["chat.conversations"] });
          }}
        />
      )}

      <MessageSearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onJump={(convId) => {
          setSearchOpen(false);
          setSelectedId(convId);
        }}
        runSearch={async (q) => (await searchMsgsFn({ data: { q } })).results}
      />

      <GlobalSearchDialog
        open={globalSearchOpen}
        onClose={() => setGlobalSearchOpen(false)}
        onSelectConversation={(id) => setSelectedId(id)}
      />

      {selectedId && (
        <TaskFromMessageDialog
          open={taskDialog.open}
          onClose={() => setTaskDialog({ open: false })}
          conversationId={selectedId}
          messageId={taskDialog.messageId ?? null}
          leadId={taskDialog.leadId ?? null}
          initialTitle={taskDialog.initialTitle}
          initialDescription={taskDialog.initialDescription}
          members={members.map((m) => ({ user_id: m.user_id, name: m.name }))}
          onSaved={() => setPanelRefresh((x) => x + 1)}
        />
      )}
    </div>
  );
}

function SidebarSection({
  title,
  icon,
  right,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center justify-between px-2">
        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/40">
          {icon}
          {title}
        </div>
        {right}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function ConversationRow({
  c,
  active,
  onClick,
}: {
  c: ConversationSummary;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors",
        active
          ? "bg-sidebar-accent/80 text-sidebar-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/40",
      )}
    >
      <ConversationIcon c={c} />
      <span className="flex-1 truncate font-medium">{conversationLabel(c)}</span>
      {c.unread_count > 0 && (
        <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold leading-none text-destructive-foreground">
          {c.unread_count}
        </span>
      )}
    </button>
  );
}

function ChannelHeader({
  title,
  subtitle,
  onToggleDetails,
  detailsOpen,
  isAnnouncement,
  onPostAnnouncement,
  conversationId,
  onDraftReply,
  onCreateTaskFromAI,
  isPopout = false,
  compact = false,
  avatarUrl,
  avatarName,
  onBack,
}: {
  title: string;
  subtitle?: string;
  onToggleDetails: () => void;
  detailsOpen: boolean;
  isAnnouncement?: boolean;
  onPostAnnouncement?: () => void;
  conversationId?: string;
  onDraftReply?: (text: string) => void;
  onCreateTaskFromAI?: (title: string, description: string) => void;
  isPopout?: boolean;
  compact?: boolean;
  avatarUrl?: string | null;
  avatarName?: string | null;
  onBack?: () => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 bg-chat-body/60 px-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            className="-ml-2 h-7 w-7 md:hidden"
            onClick={onBack}
            title="Back to chats"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        {(avatarUrl || avatarName) && (
          <AgentAvatar name={avatarName ?? undefined} path={avatarUrl ?? undefined} size="sm" />
        )}
        <span className="truncate text-sm font-semibold">{title}</span>
        {subtitle && (
          <span className="hidden truncate text-[11px] uppercase tracking-wider text-muted-foreground/70 sm:inline">
            {subtitle}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        {!compact && conversationId && (
          <AIPopover
            conversationId={conversationId}
            onDraftReply={onDraftReply}
            onCreateTaskFromAI={onCreateTaskFromAI}
          />
        )}
        {isAnnouncement && onPostAnnouncement && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 border-amber-400/40 px-2 text-xs text-amber-400 hover:bg-amber-400/10"
            onClick={onPostAnnouncement}
          >
            <Megaphone className="mr-1 h-3.5 w-3.5" />
            Post announcement
          </Button>
        )}
        {!compact && !isPopout && conversationId && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Open chat in new window"
            onClick={() => {
              const url = `/team-chat?popout=1&c=${encodeURIComponent(conversationId)}`;
              const win = window.open(
                url,
                "leadvault-team-chat",
                "width=1280,height=860,menubar=no,toolbar=no,location=no,status=no",
              );
              if (!win) {
                toast.error("Popup blocked. Allow popups for this site to detach chat.");
              } else {
                win.focus();
              }
            }}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        )}
        {!compact && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleDetails} title="Details">
            <Info className={cn("h-4 w-4", detailsOpen && "text-chat-accent")} />
          </Button>
        )}
      </div>
    </div>
  );
}

type Msg = {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  body: string | null;
  parent_message_id: string | null;
  message_type: string;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  sender_name: string;
  sender_avatar: string | null;
  reactions: { emoji: string; user_id: string }[];
  attachments: { id: string; file_path: string; file_name: string; file_type: string | null; file_size: number | null; signed_url: string | null }[];
};

function MessageList({
  messages,
  currentUserId,
  threadCounts,
  onReact,
  onPin,
  onDelete,
  onReply,
  onEdit,
  onAck,
  editingId,
  setEditingId,
  getLeadPreview,
  compact = false,
  isDM = false,
  linkedLeadId = null,
  onMessageCreateTask,
  jumpToMessageId = null,
  onJumped,
}: {
  messages: Msg[];
  currentUserId: string;
  threadCounts: Record<string, number>;
  onReact: (mid: string, emoji: string) => void | Promise<void>;
  onPin: (mid: string) => void | Promise<void>;
  onDelete: (mid: string) => void | Promise<void>;
  onReply: (mid: string) => void;
  onEdit: (mid: string, body: string) => void | Promise<void>;
  onAck: (mid: string) => void | Promise<void>;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  getLeadPreview: (id: string) => Promise<{ id: string; name: string; phone: string | null; dispo: string | null; carrier: string | null } | null>;
  compact?: boolean;
  isDM?: boolean;
  linkedLeadId?: string | null;
  onMessageCreateTask?: (messageId: string, body: string | null) => void;
  jumpToMessageId?: string | null;
  onJumped?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Jump-to-message: scroll an element into view and highlight it briefly.
  useEffect(() => {
    if (!jumpToMessageId) return;
    const el = scrollRef.current?.querySelector(`[data-msg-id="${jumpToMessageId}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-chat-accent/60", "ring-offset-2", "ring-offset-background");
      window.setTimeout(() => el.classList.remove("ring-2", "ring-chat-accent/60", "ring-offset-2", "ring-offset-background"), 1800);
    }
    onJumped?.();
  }, [jumpToMessageId, onJumped]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Say hi to start the conversation</p>
      </div>
    );
  }

  // Group flags: a message is "first of group" when the previous message has a
  // different sender, is >5min older, or either side is an announcement.
  const GROUP_GAP_MS = 5 * 60 * 1000;
  const groupFlags = messages.map((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const breakWith = (a: Msg | undefined, b: Msg) => {
      if (!a) return true;
      if (a.sender_id !== b.sender_id) return true;
      if (a.message_type === "announcement" || b.message_type === "announcement") return true;
      const dt = Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return dt > GROUP_GAP_MS;
    };
    return {
      isFirstOfGroup: breakWith(prev, m),
      isLastOfGroup: breakWith(next, m),
    };
  });

  return (
    <div
      ref={scrollRef}
      className={cn(
        "flex-1 overflow-y-auto",
        compact ? "space-y-0.5 px-2 py-3" : "space-y-4 px-4 py-4",
      )}
    >
      {messages.map((m, i) => (
        <MessageItem
          key={m.id}
          m={m}
          mine={m.sender_id === currentUserId}
          threadCount={threadCounts[m.id] ?? 0}
          onReact={onReact}
          onPin={onPin}
          onDelete={onDelete}
          onReply={onReply}
          onEdit={onEdit}
          onAck={onAck}
          isEditing={editingId === m.id}
          onBeginEdit={() => setEditingId(m.id)}
          onCancelEdit={() => setEditingId(null)}
          getLeadPreview={getLeadPreview}
          compact={compact}
          isDM={isDM}
          isFirstOfGroup={groupFlags[i].isFirstOfGroup}
          isLastOfGroup={groupFlags[i].isLastOfGroup}
          extraTopGap={compact && groupFlags[i].isFirstOfGroup && i > 0}
          linkedLeadId={linkedLeadId}
          onCreateTask={onMessageCreateTask}
        />
      ))}
    </div>
  );
}

function reactionAgg(reactions: Msg["reactions"]): Array<{ emoji: string; users: string[] }> {
  const m = new Map<string, string[]>();
  for (const r of reactions) {
    const list = m.get(r.emoji) ?? [];
    list.push(r.user_id);
    m.set(r.emoji, list);
  }
  return Array.from(m.entries()).map(([emoji, users]) => ({ emoji, users }));
}

const LEAD_URL_RE = /\/leads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function MessageItem({
  m,
  mine,
  threadCount,
  onReact,
  onPin,
  onDelete,
  onReply,
  onEdit,
  onAck,
  isEditing,
  onBeginEdit,
  onCancelEdit,
  getLeadPreview,
  compact = false,
  isDM = false,
  isFirstOfGroup = true,
  isLastOfGroup = true,
  extraTopGap = false,
  linkedLeadId = null,
  onCreateTask,
}: {
  m: Msg;
  mine: boolean;
  threadCount: number;
  onReact: (mid: string, emoji: string) => void | Promise<void>;
  onPin: (mid: string) => void | Promise<void>;
  onDelete: (mid: string) => void | Promise<void>;
  onReply: (mid: string) => void;
  onEdit: (mid: string, body: string) => void | Promise<void>;
  onAck: (mid: string) => void | Promise<void>;
  isEditing: boolean;
  onBeginEdit: () => void;
  onCancelEdit: () => void;
  getLeadPreview: (id: string) => Promise<{ id: string; name: string; phone: string | null; dispo: string | null; carrier: string | null } | null>;
  compact?: boolean;
  isDM?: boolean;
  isFirstOfGroup?: boolean;
  isLastOfGroup?: boolean;
  extraTopGap?: boolean;
  linkedLeadId?: string | null;
  onCreateTask?: (messageId: string, body: string | null) => void;
}) {
  const [lead, setLead] = useState<Awaited<ReturnType<typeof getLeadPreview>> | null>(null);
  const [editBody, setEditBody] = useState(m.body ?? "");
  useEffect(() => {
    if (isEditing) setEditBody(m.body ?? "");
  }, [isEditing, m.body]);
  const leadMatch = useMemo(() => m.body?.match(LEAD_URL_RE)?.[1] ?? null, [m.body]);
  useEffect(() => {
    if (!leadMatch) return;
    let cancelled = false;
    void getLeadPreview(leadMatch).then((l) => {
      if (!cancelled) setLead(l);
    });
    return () => {
      cancelled = true;
    };
  }, [leadMatch, getLeadPreview]);

  const agg = reactionAgg(m.reactions);
  const isAnnouncement = m.message_type === "announcement";

  // Compact / Messenger-style branch for chat bubble window. Announcements
  // keep the full-width amber card below.
  if (compact && !isAnnouncement) {
    const isGif = !!m.body?.match(/^\[gif\](\S+)\s*$/);
    const bubbleBase = "w-fit max-w-full text-sm leading-snug";
    const bubbleSkin = isGif
      ? "bg-transparent p-0"
      : cn(
          "px-3 py-1.5 rounded-2xl",
          mine
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
          // Tail rounding to merge adjacent same-group bubbles
          mine && !isFirstOfGroup && "rounded-tr-md",
          mine && !isLastOfGroup && "rounded-br-md",
          !mine && !isFirstOfGroup && "rounded-tl-md",
          !mine && !isLastOfGroup && "rounded-bl-md",
        );
    const rowAlign = mine ? "justify-end" : "justify-start";
    const laneAlign = mine ? "ml-auto" : "mr-auto";
    const bubbleWidth = "max-w-[78%]";
    const tsLabel = formatTime(m.created_at);
    return (
      <div data-msg-id={m.id} className={cn("group rounded-md", extraTopGap && "mt-3")}>
        {/* Sender name once per group (only in non-DM, non-mine) */}
        {isFirstOfGroup && !mine && !isDM && (
          <div className="mb-0.5 ml-9 text-[11px] font-medium text-muted-foreground">
            {m.sender_name}
          </div>
        )}
        <div className={cn("flex gap-2", rowAlign)}>
          {/* Avatar gutter (28px) on left for non-mine */}
          {!mine && (
            <div className="w-7 shrink-0">
              {isLastOfGroup ? (
                <AgentAvatar name={m.sender_name} path={m.sender_avatar} size="sm" />
              ) : null}
            </div>
          )}

          <div className="min-w-0 flex-1">
            {m.deleted_at ? (
              <div className={cn("w-full", mine && "flex justify-end")}>
                <div className={cn(bubbleWidth, laneAlign)}>
                  <div className="w-fit max-w-full rounded-2xl bg-muted/60 px-3 py-1.5 text-xs italic text-muted-foreground">
                    message deleted
                  </div>
                </div>
              </div>
            ) : isEditing ? (
              <div className={cn("w-full", mine && "flex justify-end")}>
                <div className={cn("w-full space-y-1", bubbleWidth, laneAlign)}>
                  <Textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={3}
                    className="text-sm"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void onEdit(m.id, editBody)} disabled={!editBody.trim()}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={onCancelEdit}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className={cn("w-full", mine && "flex justify-end")}>
                <div className={cn("relative", bubbleWidth, laneAlign)}>
                  {m.body && (
                    <div className={cn(bubbleBase, bubbleSkin)} title={tsLabel}>
                      {isGif ? (
                        <MessageBody body={m.body} />
                      ) : (
                        <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                          {m.body}
                          {m.edited_at && (
                            <span className={cn("ml-1 text-[10px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                              (edited)
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  )}
                  {/* Hover action toolbar (opposite side) */}
                  <div
                    className={cn(
                      "pointer-events-none absolute top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100",
                      mine ? "right-full mr-1" : "left-full ml-1",
                    )}
                  >
                    <div className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 shadow-sm">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6" title="React">
                            <Smile className="h-3 w-3" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-1">
                          <div className="flex gap-1">
                            {COMMON_EMOJIS.map((e) => (
                              <button
                                key={e}
                                className="rounded p-1 text-lg hover:bg-accent/40"
                                onClick={() => onReact(m.id, e)}
                              >
                                {e}
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Button variant="ghost" size="icon" className="h-6 w-6" title="Reply" onClick={() => onReply(m.id)}>
                        <Reply className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" title="Pin" onClick={() => onPin(m.id)}>
                        <Pin className="h-3 w-3" />
                      </Button>
                      {onCreateTask && (
                        <Button variant="ghost" size="icon" className="h-6 w-6" title="Create task" onClick={() => onCreateTask(m.id, m.body)}>
                          <Check className="h-3 w-3" />
                        </Button>
                      )}
                      {mine && !m.deleted_at && (
                        <Button variant="ghost" size="icon" className="h-6 w-6" title="Edit" onClick={onBeginEdit}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                      <MessageMoreMenu
                        messageId={m.id}
                        messageBody={m.body}
                        mine={mine}
                        linkedLeadId={linkedLeadId}
                        onCreateTask={() => onCreateTask?.(m.id, m.body)}
                        onEdit={mine ? onBeginEdit : undefined}
                        onDelete={mine ? () => onDelete(m.id) : undefined}
                        onOpenLead={(lid) => window.open(`/leads/${lid}`, "_blank")}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Attachments */}
            {m.attachments.length > 0 && (
              <div className={cn("mt-1 w-full", mine && "flex justify-end")}>
                <div className={cn("flex max-w-[78%] flex-wrap gap-1.5", laneAlign, mine && "justify-end")}>
                  {m.attachments.map((a) => (
                    <AttachmentChip key={a.id} a={a} />
                  ))}
                </div>
              </div>
            )}

            {/* Lead preview */}
            {lead && (
              <div className={cn("mt-1 w-full", mine && "flex justify-end")}>
                <a
                  href={`/leads/${lead.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    "inline-flex w-full flex-col rounded-md border border-border bg-card p-2 transition-colors hover:border-primary/40",
                    bubbleWidth,
                    laneAlign,
                  )}
                >
                  <div className="text-[10px] font-bold uppercase tracking-widest text-primary">Lead Vault</div>
                  <div className="text-sm font-semibold">{lead.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {lead.phone} {lead.carrier ? `· ${lead.carrier}` : ""}
                  </div>
                </a>
              </div>
            )}

            {/* Reactions */}
            {agg.length > 0 && (
              <div className={cn("mt-1 w-full", mine && "flex justify-end")}>
                <div className={cn("flex max-w-[78%] flex-wrap gap-1", laneAlign, mine && "justify-end")}>
                  {agg.map((r) => (
                    <button
                      key={r.emoji}
                      onClick={() => onReact(m.id, r.emoji)}
                      className="flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-0.5 text-xs hover:bg-accent/30"
                    >
                      <span>{r.emoji}</span>
                      <span className="text-[10px] tabular-nums text-muted-foreground">{r.users.length}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Thread replies pill */}
            {threadCount > 0 && (
              <div className={cn("mt-1 w-full", mine && "flex justify-end")}>
                <button
                  onClick={() => onReply(m.id)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-xs text-primary hover:bg-accent/30",
                    laneAlign,
                  )}
                >
                  <Reply className="h-3 w-3" />
                  {threadCount} {threadCount === 1 ? "reply" : "replies"}
                </button>
              </div>
            )}

            {/* Timestamp under last bubble of group */}
            {isLastOfGroup && (
              <div className={cn("mt-0.5 w-full", mine && "flex justify-end")}>
                <div className={cn(bubbleWidth, laneAlign)}>
                  <div className={cn("text-[10px] text-muted-foreground", mine ? "text-right" : "text-left")}>
                    {tsLabel}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Avatar gutter (28px) on right for mine */}
          {mine && (
            <div className="w-7 shrink-0">
              {isLastOfGroup ? (
                <AgentAvatar name={m.sender_name} path={m.sender_avatar} size="sm" />
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div data-msg-id={m.id} className={cn("group flex gap-3 rounded-md transition-shadow", isAnnouncement && "border-l-2 border-amber-500 bg-amber-500/5 p-3")}>
      <AgentAvatar name={m.sender_name} path={m.sender_avatar} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">{m.sender_name}</span>
          {isAnnouncement && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-600">
              Announcement
            </span>
          )}
          <span className="text-[10px] uppercase text-muted-foreground">{formatTime(m.created_at)}</span>
          {m.edited_at && <span className="text-[10px] text-muted-foreground">(edited)</span>}
        </div>
        {m.deleted_at ? (
          <div className="text-sm italic text-muted-foreground">message deleted</div>
        ) : (
          <>
            {isEditing ? (
              <div className="mt-1 space-y-1">
                <Textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={3}
                  className="text-sm"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void onEdit(m.id, editBody)} disabled={!editBody.trim()}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={onCancelEdit}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : m.body && (
          <MessageBody body={m.body} />
            )}
            {m.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {m.attachments.map((a) => (
                  <AttachmentChip key={a.id} a={a} />
                ))}
              </div>
            )}
            {lead && (
              <a
                href={`/leads/${lead.id}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex max-w-sm flex-col rounded-md border border-border bg-card p-3 transition-colors hover:border-primary/40"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-primary">Lead Vault</div>
                    <div className="text-sm font-semibold">{lead.name}</div>
                  </div>
                  {lead.dispo && (
                    <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase text-secondary-foreground">
                      {lead.dispo}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {lead.phone} {lead.carrier ? `· ${lead.carrier}` : ""}
                </div>
              </a>
            )}
            {agg.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {agg.map((r) => (
                  <button
                    key={r.emoji}
                    onClick={() => onReact(m.id, r.emoji)}
                    className="flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-0.5 text-xs hover:bg-accent/30"
                  >
                    <span>{r.emoji}</span>
                    <span className="text-[10px] tabular-nums text-muted-foreground">{r.users.length}</span>
                  </button>
                ))}
              </div>
            )}
            {threadCount > 0 && (
              <button
                onClick={() => onReply(m.id)}
                className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-xs text-primary hover:bg-accent/30"
              >
                <Reply className="h-3 w-3" />
                {threadCount} {threadCount === 1 ? "reply" : "replies"}
              </button>
            )}
            {isAnnouncement && (
              <button
                onClick={() => onAck(m.id)}
                className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-500/25"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Acknowledge
              </button>
            )}
          </>
        )}
      </div>
      <div className="opacity-0 transition-opacity group-hover:opacity-100">
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 shadow-sm">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" title="React">
                <Smile className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-1">
              <div className="flex gap-1">
                {COMMON_EMOJIS.map((e) => (
                  <button
                    key={e}
                    className="rounded p-1 text-lg hover:bg-accent/40"
                    onClick={() => onReact(m.id, e)}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Reply in thread" onClick={() => onReply(m.id)}>
            <Reply className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Pin" onClick={() => onPin(m.id)}>
            <Pin className="h-3.5 w-3.5" />
          </Button>
          {onCreateTask && (
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Create task" onClick={() => onCreateTask(m.id, m.body)}>
              <Check className="h-3.5 w-3.5" />
            </Button>
          )}
          <MessageMoreMenu
            messageId={m.id}
            messageBody={m.body}
            mine={mine}
            linkedLeadId={linkedLeadId}
            onCreateTask={() => onCreateTask?.(m.id, m.body)}
            onEdit={mine && !m.deleted_at ? onBeginEdit : undefined}
            onDelete={mine ? () => onDelete(m.id) : undefined}
            onOpenLead={(lid) => window.open(`/leads/${lid}`, "_blank")}
          />
        </div>
      </div>
    </div>
  );
}

function AttachmentChip({ a }: { a: Msg["attachments"][number] }) {
  const isImage = a.file_type?.startsWith("image/");
  const isAudio = a.file_type?.startsWith("audio/");
  if (isImage && a.signed_url) {
    return (
      <a href={a.signed_url} target="_blank" rel="noreferrer" className="block">
        <img
          src={a.signed_url}
          alt={a.file_name}
          className="max-h-64 max-w-xs rounded-md border border-border object-cover"
        />
      </a>
    );
  }
  if (isAudio && a.signed_url) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
        <audio src={a.signed_url} controls className="h-8 max-w-[260px]" />
        <a href={a.signed_url} download={a.file_name} className="text-[10px] text-muted-foreground hover:text-foreground">
          download
        </a>
      </div>
    );
  }
  return (
    <a
      href={a.signed_url ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 hover:bg-accent/30"
    >
      <FileText className="h-5 w-5 text-primary" />
      <div className="text-xs">
        <div className="font-semibold">{a.file_name}</div>
        <div className="text-muted-foreground">
          {a.file_size ? `${Math.round(a.file_size / 1024)} KB` : ""}
        </div>
      </div>
    </a>
  );
}

/**
 * Render message body. Detects `[gif]<url>` markers (sent by GifPicker)
 * and renders the GIF inline; otherwise renders plain text.
 */
function MessageBody({ body }: { body: string }) {
  const gifMatch = body.match(/^\[gif\](\S+)\s*$/);
  if (gifMatch) {
    return (
      <a href={gifMatch[1]} target="_blank" rel="noreferrer" className="mt-1 block">
        <img
          src={gifMatch[1]}
          alt="GIF"
          className="max-h-64 max-w-xs rounded-md border border-border object-cover"
          loading="lazy"
        />
      </a>
    );
  }
  return <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{body}</div>;
}

function TypingIndicator({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  const label =
    names.length === 1
      ? `${names[0]} is typing…`
      : names.length === 2
      ? `${names[0]} and ${names[1]} are typing…`
      : `${names.length} people are typing…`;
  return (
    <div className="px-4 py-1 text-xs text-muted-foreground">
      <span className="inline-block animate-pulse">●</span> {label}
    </div>
  );
}

function Composer({
  conversationId,
  onSend,
  onTyping,
  onRequestUploadUrl,
  compact = false,
  insert,
  onInsertConsumed,
  linkedLeadId,
  onSlashTask,
}: {
  conversationId: string;
  onSend: (
    body: string,
    attachments?: { file_path: string; file_name: string; file_type?: string; file_size?: number }[],
    mentionUserIds?: string[],
    mentionEveryone?: boolean,
  ) => Promise<void>;
  onTyping: () => void;
  onRequestUploadUrl: (fileName: string) => Promise<{ path: string; token: string; signedUrl: string }>;
  compact?: boolean;
  insert?: string | null;
  onInsertConsumed?: () => void;
  linkedLeadId?: string | null;
  onSlashTask?: () => void;
}) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<{ file: File; path: string; uploading: boolean; error?: string }[]>([]);
  const [mentions, setMentions] = useState<MentionPick[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [voiceSending, setVoiceSending] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const linkLead = useServerFn(shareLeadToConversation);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTypingAt = useRef(0);

  useEffect(() => {
    setBody("");
    setPending([]);
    setMentions([]);
    setMentionQuery(null);
    setSlashQuery(null);
  }, [conversationId]);

  useEffect(() => {
    if (insert) {
      setBody((b) => (b ? `${b}\n${insert}` : insert));
      onInsertConsumed?.();
      taRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insert]);

  const handleSlashPick = async (id: SlashCommandId) => {
    setSlashQuery(null);
    // Strip the leading slash command token from the body
    setBody((b) => b.replace(/^\/\w*\s?/, ""));
    if (id === "lead") {
      toast.info("Paste a /leads/<id> URL to link a lead");
    } else if (id === "task") {
      onSlashTask?.();
    } else if (id === "note") {
      toast.info("Type your note, send, and it will be saved");
    } else if (id === "call") {
      if (linkedLeadId) window.open(`/leads/${linkedLeadId}`, "_blank");
      else toast.info("Link a lead first to start a call");
    } else if (id === "transfer") {
      toast.info("Mention a teammate to request a transfer");
      setBody((b) => `@${b}`);
    } else if (id === "template") {
      toast.info("Open the templates menu via the bookmark icon");
    }
    taRef.current?.focus();
  };

  const submit = async () => {
    const text = body.trim();
    if (!text && pending.length === 0) return;
    if (pending.some((p) => p.uploading)) {
      toast.error("Uploads still in progress");
      return;
    }
    const mentionEveryone = mentions.some((m) => m.id === "__everyone__");
    const mentionUserIds = mentions.filter((m) => m.id !== "__everyone__").map((m) => m.id);
    try {
      await onSend(
        text,
        pending.map((p) => ({
          file_path: p.path,
          file_name: p.file.name,
          file_type: p.file.type,
          file_size: p.file.size,
        })),
        mentionUserIds,
        mentionEveryone,
      );
      setBody("");
      setPending([]);
      setMentions([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send");
    }
  };

  const uploadFiles = async (files: File[]) => {
    for (const file of files) {
      const placeholder: { file: File; path: string; uploading: boolean; error?: string } = {
        file,
        path: "",
        uploading: true,
      };
      setPending((p) => [...p, placeholder]);
      try {
        const { path, token } = await onRequestUploadUrl(file.name);
        const { error } = await supabase.storage.from("chat-attachments").uploadToSignedUrl(path, token, file);
        if (error) throw error;
        setPending((p) =>
          p.map((x) => (x === placeholder ? { ...x, path, uploading: false } : x)),
        );
      } catch (e) {
        setPending((p) =>
          p.map((x) =>
            x === placeholder ? { ...x, uploading: false, error: e instanceof Error ? e.message : "Upload failed" } : x,
          ),
        );
        toast.error(e instanceof Error ? e.message : "Upload failed");
      }
    }
  };

  return (
    <div
      className="border-t border-border bg-chat-composer/60 p-3"
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        if (files.length) void uploadFiles(files);
      }}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData?.files ?? []);
        if (files.length) {
          void uploadFiles(files);
          return;
        }
        const text = e.clipboardData?.getData("text") ?? "";
        const m = text.match(/\/leads\/([0-9a-f-]{36})/i);
        if (m) {
          e.preventDefault();
          const leadId = m[1];
          (async () => {
            try {
              await linkLead({ data: { conversationId, leadId } });
              toast.success("Lead linked to this chat");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed to link lead");
            }
          })();
        }
      }}
    >
      {pending.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pending.map((p, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              {p.file.type.startsWith("image/") ? <ImageIcon className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
              <span className="max-w-[160px] truncate">{p.file.name}</span>
              {p.uploading && <span className="text-muted-foreground">uploading…</span>}
              {p.error && <span className="text-destructive">{p.error}</span>}
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setPending((arr) => arr.filter((_, j) => j !== i))}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {mentions.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {mentions.map((m) => (
            <span
              key={m.id}
              className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary"
            >
              @{m.name}
              <button
                className="text-primary/70 hover:text-primary"
                onClick={() => setMentions((arr) => arr.filter((x) => x.id !== m.id))}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      {(() => {
        const toolbar = (
          <>
            <DropdownMenu open={plusOpen} onOpenChange={setPlusOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground" title="More">
                  <Plus className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuItem onSelect={() => { setPlusOpen(false); toast.info("Paste a /leads/<id> URL to link a lead"); }}>
                  <Pin className="mr-2 h-4 w-4 text-chat-accent" /> Link a lead
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { setPlusOpen(false); onSlashTask?.(); }}>
                  <Check className="mr-2 h-4 w-4 text-chat-accent" /> Create task from message
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { setPlusOpen(false); toast.info("Schedule send — coming soon"); }}>
                  <Settings className="mr-2 h-4 w-4 text-chat-accent" /> Schedule message
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <TemplatePicker
              onPick={(b) => {
                setBody((cur) => (cur ? `${cur}\n${b}` : b));
                taRef.current?.focus();
              }}
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground" title="Emoji">
                  <Smile className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2" align="start">
                <div className="grid grid-cols-8 gap-1">
                  {COMMON_EMOJIS.concat(["🚀", "🙏", "😎", "🤔", "🥳", "💪", "✨", "📌"]).map((e) => (
                    <button
                      key={e}
                      className="rounded p-1 text-lg hover:bg-accent/40"
                      onClick={() => {
                        setBody((b) => b + e);
                        taRef.current?.focus();
                      }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              title="Attach"
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) void uploadFiles(files);
                e.target.value = "";
              }}
            />
            <Popover open={gifOpen} onOpenChange={setGifOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground" title="Send a GIF">
                  <span className="text-[10px] font-bold tracking-wide">GIF</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2" align="start">
                <GifPicker
                  onPick={async (url) => {
                    setGifOpen(false);
                    try {
                      await onSend(`[gif]${url}`);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed to send GIF");
                    }
                  }}
                />
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              title="Mention"
              onClick={() => {
                setBody((b) => b + "@");
                setMentionQuery("");
                taRef.current?.focus();
              }}
            >
              <AtSign className="h-4 w-4" />
            </Button>
            <VoiceRecorder
              sending={voiceSending}
              onSend={async (file, durationMs) => {
                setVoiceSending(true);
                try {
                  const { path, token } = await onRequestUploadUrl(file.name);
                  const { error: upErr } = await supabase.storage
                    .from("chat-attachments")
                    .uploadToSignedUrl(path, token, file);
                  if (upErr) throw upErr;
                  const seconds = Math.max(1, Math.round(durationMs / 1000));
                  await onSend(`🎤 Voice note · ${formatDuration(seconds)}`, [
                    {
                      file_path: path,
                      file_name: file.name,
                      file_type: file.type,
                      file_size: file.size,
                    },
                  ]);
                } finally {
                  setVoiceSending(false);
                }
              }}
            />
          </>
        );
        const textareaBlock = (
          <div className="relative min-w-0 flex-1">
            {mentionQuery !== null && (
              <MentionAutocomplete
                query={mentionQuery}
                onPick={(u) => {
                  setMentions((arr) => (arr.some((x) => x.id === u.id) ? arr : [...arr, u]));
                  setBody((b) => b.replace(/@[^\s@]*$/, `@${u.name.split(" ")[0]} `));
                  setMentionQuery(null);
                  taRef.current?.focus();
                }}
                onDismiss={() => setMentionQuery(null)}
              />
            )}
            {slashQuery !== null && (
              <SlashCommandMenu
                query={slashQuery}
                onPick={(id) => void handleSlashPick(id)}
                onDismiss={() => setSlashQuery(null)}
              />
            )}
            <Textarea
              ref={taRef}
              value={body}
              onChange={(e) => {
                const v = e.target.value;
                setBody(v);
                const m = v.match(/@([^\s@]*)$/);
                setMentionQuery(m ? m[1] : null);
                const sm = v.match(/^\/(\w*)$/);
                setSlashQuery(sm ? sm[1] : null);
                const now = Date.now();
                if (now - lastTypingAt.current > 1500) {
                  lastTypingAt.current = now;
                  onTyping();
                }
              }}
              onKeyDown={(e) => {
                if ((e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
                  e.preventDefault();
                  void submit();
                } else if (e.key === "Enter" && !e.shiftKey && mentionQuery === null && slashQuery === null) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="Message"
              className="min-h-[56px] w-full resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0"
            />
          </div>
        );
        const sendButton = (
          <Button
            size="icon"
            className="h-9 w-9 shrink-0 rounded-lg bg-chat-accent text-chat-accent-foreground shadow-sm hover:brightness-110 disabled:opacity-40"
            onClick={() => void submit()}
            disabled={!body.trim() && pending.length === 0}
            title="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        );
        if (compact) {
          return (
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-background px-2 py-1.5 shadow-sm focus-within:border-chat-accent/50">
              {textareaBlock}
              <div className="flex items-center justify-between gap-1 border-t border-border/60 pt-1">
                <div className="flex items-center gap-0.5 [&_button]:h-8 [&_button]:w-8">{toolbar}</div>
                {sendButton}
              </div>
            </div>
          );
        }
        return (
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-background px-2 py-1.5 shadow-sm transition-colors focus-within:border-chat-accent/50">
            {textareaBlock}
            <div className="flex items-center justify-between gap-1 border-t border-border/60 pt-1">
              <div className="flex items-center gap-0.5 [&_button]:h-8 [&_button]:w-8">{toolbar}</div>
              {sendButton}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/** Global message search dialog. */
function MessageSearchDialog({
  open,
  onClose,
  onJump,
  runSearch,
}: {
  open: boolean;
  onClose: () => void;
  onJump: (conversationId: string) => void;
  runSearch: (q: string) => Promise<Array<{ id: string; conversation_id: string; conversation_name: string; body: string; sender_name: string; created_at: string }>>;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof runSearch>>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setQ("");
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    const id = setTimeout(() => {
      void runSearch(q.trim())
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(id);
  }, [q, runSearch]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Search messages</DialogTitle>
        </DialogHeader>
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search across all your conversations…" />
        <ScrollArea className="h-80">
          <div className="space-y-1 p-1">
            {loading && <div className="p-3 text-xs text-muted-foreground">Searching…</div>}
            {!loading && q.trim() && results.length === 0 && (
              <div className="p-3 text-xs text-muted-foreground">No matches.</div>
            )}
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => onJump(r.conversation_id)}
                className="block w-full rounded-md border border-border bg-card p-2 text-left hover:border-primary/40"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-primary">
                    # {r.conversation_name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {format(new Date(r.created_at), "MMM d, h:mm a")}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{r.sender_name}</div>
                <div className="mt-0.5 truncate text-sm">{r.body}</div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function DetailsPanel({
  conversation,
  members,
  messages,
  onClose,
  refreshKey,
  linkedLeadId,
  onJumpToMessage,
  onNewTask,
  onCreateTaskForLead,
}: {
  conversation: { id: string; name: string | null; type: string; is_private: boolean };
  members: Array<{ user_id: string; name: string; email: string | null; avatar_url: string | null; presence: string; role: string }>;
  messages: Msg[];
  onClose: () => void;
  refreshKey?: number;
  linkedLeadId?: string | null;
  onJumpToMessage?: (mid: string) => void;
  onNewTask?: () => void;
  onCreateTaskForLead?: (leadId: string) => void;
}) {
  const sharedFiles = useMemo(
    () => messages.flatMap((m) => m.attachments).slice(0, 8),
    [messages],
  );
  const relatedLeadIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) {
      const match = m.body?.match(LEAD_URL_RE);
      if (match) set.add(match[1]);
    }
    return Array.from(set).slice(0, 5);
  }, [messages]);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <span className="text-sm font-semibold">Details</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <Tabs defaultValue="info" className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="grid h-9 w-full grid-cols-6 rounded-none border-b border-border bg-background p-0">
          <TabsTrigger value="info" className="rounded-none text-[10px] data-[state=active]:border-b-2 data-[state=active]:border-chat-accent">Info</TabsTrigger>
          <TabsTrigger value="members" className="rounded-none text-[10px] data-[state=active]:border-b-2 data-[state=active]:border-chat-accent">Members</TabsTrigger>
          <TabsTrigger value="files" className="rounded-none text-[10px] data-[state=active]:border-b-2 data-[state=active]:border-chat-accent">Files</TabsTrigger>
          <TabsTrigger value="leads" className="rounded-none text-[10px] data-[state=active]:border-b-2 data-[state=active]:border-chat-accent">Leads</TabsTrigger>
          <TabsTrigger value="pinned" className="rounded-none text-[10px] data-[state=active]:border-b-2 data-[state=active]:border-chat-accent">Pinned</TabsTrigger>
          <TabsTrigger value="tasks" className="rounded-none text-[10px] data-[state=active]:border-b-2 data-[state=active]:border-chat-accent">Tasks</TabsTrigger>
        </TabsList>
        <ScrollArea className="flex-1">
          <TabsContent value="info" className="m-0 p-4">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">About</div>
            <div className="text-sm font-semibold">
              {conversation.type === "dm" ? "Direct message" : `# ${conversation.name}`}
            </div>
            <div className="text-xs text-muted-foreground">{conversation.is_private ? "Private" : "Open to the team"}</div>
          </TabsContent>
          <TabsContent value="members" className="m-0 p-4">
            <div className="space-y-2">
              {members.slice(0, 50).map((m) => (
                <div key={m.user_id} className="flex items-center gap-2">
                  <div className="relative">
                    <AgentAvatar name={m.name} path={m.avatar_url} size="sm" />
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-card",
                        m.presence === "online" && "bg-emerald-500",
                        m.presence === "away" && "bg-amber-400",
                        m.presence === "busy" && "bg-rose-500",
                        (!m.presence || m.presence === "offline") && "bg-muted-foreground/40",
                      )}
                    />
                  </div>
                  <div className="min-w-0 flex-1 truncate text-xs">{m.name}</div>
                  {m.role !== "member" && (
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{m.role}</span>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="files" className="m-0 p-4">
            {sharedFiles.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">No files shared yet.</div>
            ) : (
              <div className="space-y-1.5">
                {sharedFiles.map((a) => (
                  <a
                    key={a.id}
                    href={a.signed_url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded border border-border bg-background px-2 py-1.5 text-xs hover:bg-accent/30"
                  >
                    {a.file_type?.startsWith("image/") ? <ImageIcon className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                    <span className="truncate">{a.file_name}</span>
                  </a>
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="leads" className="m-0 p-4">
            <RelatedLeadsSection
              conversationId={conversation.id}
              refreshKey={refreshKey}
              onCreateTask={onCreateTaskForLead}
            />
          </TabsContent>
          <TabsContent value="pinned" className="m-0 p-4">
            <PinnedMessagesSection
              conversationId={conversation.id}
              refreshKey={refreshKey}
              onJump={onJumpToMessage}
            />
          </TabsContent>
          <TabsContent value="tasks" className="m-0 p-4">
            <TasksSection
              conversationId={conversation.id}
              refreshKey={refreshKey}
              onNewTask={onNewTask}
            />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </aside>
  );
}

function NewMessageDialog({
  open,
  onClose,
  onPick,
  search,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (userId: string) => void;
  search: (q: string) => Promise<Array<{ id: string; full_name: string | null; email: string | null; avatar_url: string | null }>>;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; full_name: string | null; email: string | null; avatar_url: string | null }>>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void search(q).then((r) => {
      if (!cancelled) setResults(r);
    });
    return () => {
      cancelled = true;
    };
  }, [q, open, search]);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New direct message</DialogTitle>
        </DialogHeader>
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search teammates…" />
        <div className="max-h-72 overflow-y-auto">
          {results.map((u) => (
            <button
              key={u.id}
              onClick={() => onPick(u.id)}
              className="flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-accent/40"
            >
              <AgentAvatar name={u.full_name ?? u.email} path={u.avatar_url} size="sm" />
              <div className="text-sm">
                <div className="font-medium">{u.full_name ?? u.email}</div>
                {u.full_name && <div className="text-xs text-muted-foreground">{u.email}</div>}
              </div>
            </button>
          ))}
          {results.length === 0 && <div className="p-4 text-center text-xs text-muted-foreground">No teammates found.</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewChannelDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, isPrivate: boolean) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  useEffect(() => {
    if (!open) {
      setName("");
      setIsPrivate(false);
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create channel</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Channel name</label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. autobots"
            />
            <div className="mt-1 text-[11px] text-muted-foreground">
              Lowercase letters, numbers, and dashes only.
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
            <Lock className="h-3.5 w-3.5" /> Private (only invited members)
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void onCreate(name, isPrivate)} disabled={!name.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// re-export for ChatLauncher convenience
export { COMMON_EMOJIS, relativeTime, conversationLabel, ConversationIcon };