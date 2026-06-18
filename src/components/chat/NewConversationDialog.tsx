import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Hash, Lock, MessageSquare, Users, X, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  searchTeammates,
  createDM,
  createGroupDM,
  createChannel,
} from "@/lib/chat.functions";

export type NewConversationMode = "dm" | "group" | "channel";

export type NewConversationMeta = {
  type: NewConversationMode;
  dmUserId?: string;
};

type User = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

/** Unified dialog for starting a DM, Group DM, or Channel. */
export function NewConversationDialog({
  open,
  initialMode = "dm",
  allowChannel = true,
  onClose,
  onCreated,
}: {
  open: boolean;
  initialMode?: NewConversationMode;
  allowChannel?: boolean;
  onClose: () => void;
  onCreated: (conversationId: string, meta?: NewConversationMeta) => void;
}) {
  const [mode, setMode] = useState<NewConversationMode>(
    !allowChannel && initialMode === "channel" ? "dm" : initialMode,
  );
  const [q, setQ] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [picked, setPicked] = useState<User[]>([]);
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const search = useServerFn(searchTeammates);
  const startDM = useServerFn(createDM);
  const startGroup = useServerFn(createGroupDM);
  const startChannel = useServerFn(createChannel);

  useEffect(() => {
    if (!open) return;
    setMode(!allowChannel && initialMode === "channel" ? "dm" : initialMode);
    setQ("");
    setPicked([]);
    setName("");
    setIsPrivate(false);
  }, [open, initialMode, allowChannel]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void search({ data: { q } }).then((r) => {
      if (!cancelled) setResults(r.users);
    });
    return () => {
      cancelled = true;
    };
  }, [q, open, search]);

  const pickedIds = useMemo(() => new Set(picked.map((p) => p.id)), [picked]);

  const togglePick = (u: User) => {
    if (mode === "dm") {
      // single-select → immediately create
      void submitDM(u.id);
      return;
    }
    setPicked((arr) =>
      arr.some((x) => x.id === u.id) ? arr.filter((x) => x.id !== u.id) : [...arr, u],
    );
  };

  const submitDM = async (uid: string) => {
    setSubmitting(true);
    try {
      const { id } = await startDM({ data: { otherUserId: uid } });
      onCreated(id, { type: "dm", dmUserId: uid });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start DM");
    } finally {
      setSubmitting(false);
    }
  };

  const submitGroup = async () => {
    if (picked.length < 2) {
      toast.error("Pick at least 2 teammates");
      return;
    }
    setSubmitting(true);
    try {
      const { id } = await startGroup({
        data: { userIds: picked.map((p) => p.id), name: name.trim() || undefined },
      });
      onCreated(id, { type: "group" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create group chat");
    } finally {
      setSubmitting(false);
    }
  };

  const submitChannel = async () => {
    const cleaned = name.trim();
    if (!cleaned) {
      toast.error("Channel needs a name");
      return;
    }
    setSubmitting(true);
    try {
      const { id } = await startChannel({
        data: {
          name: cleaned,
          isPrivate,
          memberIds: picked.map((p) => p.id),
        },
      });
      onCreated(id, { type: "channel" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create channel");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
        </DialogHeader>

        {/* Mode switcher */}
        <div className={cn("grid gap-1 rounded-md border border-border bg-muted/30 p-1", allowChannel ? "grid-cols-3" : "grid-cols-2")}>
          <ModeTab active={mode === "dm"} onClick={() => setMode("dm")} icon={<MessageSquare className="h-3.5 w-3.5" />} label="Direct" />
          <ModeTab active={mode === "group"} onClick={() => setMode("group")} icon={<Users className="h-3.5 w-3.5" />} label="Group" />
          {allowChannel && (
            <ModeTab active={mode === "channel"} onClick={() => setMode("channel")} icon={<Hash className="h-3.5 w-3.5" />} label="Channel" />
          )}
        </div>

        {/* Channel name + privacy */}
        {mode === "channel" && (
          <div className="space-y-2 pt-2">
            <div>
              <label className="text-xs font-medium">Channel name</label>
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. sales-pod"
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
        )}

        {/* Group name (optional) */}
        {mode === "group" && (
          <div className="pt-2">
            <label className="text-xs font-medium">Group name (optional)</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q3 War Room"
            />
          </div>
        )}

        {/* Picked chips */}
        {(mode === "group" || mode === "channel") && picked.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {picked.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary"
              >
                {p.full_name ?? p.email}
                <button
                  className="text-primary/70 hover:text-primary"
                  onClick={() => setPicked((arr) => arr.filter((x) => x.id !== p.id))}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Teammate search */}
        <div className="space-y-2">
          <Input
            autoFocus={mode !== "channel"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              mode === "channel"
                ? "Invite teammates (optional)…"
                : "Search teammates…"
            }
          />
          <div className="max-h-56 overflow-y-auto rounded-md border border-border">
            {results.length === 0 && (
              <div className="p-4 text-center text-xs text-muted-foreground">
                No teammates found.
              </div>
            )}
            {results.map((u) => {
              const isPicked = pickedIds.has(u.id);
              return (
                <button
                  key={u.id}
                  onClick={() => togglePick(u)}
                  disabled={submitting}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-accent/40",
                    isPicked && "bg-primary/10",
                  )}
                >
                  <AgentAvatar name={u.full_name ?? u.email} path={u.avatar_url} size="sm" />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="truncate font-medium">{u.full_name ?? u.email}</div>
                    {u.full_name && (
                      <div className="truncate text-[11px] text-muted-foreground">{u.email}</div>
                    )}
                  </div>
                  {mode !== "dm" && isPicked && <Check className="h-4 w-4 text-primary" />}
                </button>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          {mode === "group" && (
            <Button onClick={() => void submitGroup()} disabled={submitting || picked.length < 2}>
              {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Create group ({picked.length})
            </Button>
          )}
          {mode === "channel" && (
            <Button onClick={() => void submitChannel()} disabled={submitting || !name.trim()}>
              {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Create channel
            </Button>
          )}
          {mode === "dm" && (
            <span className="text-[11px] text-muted-foreground">Pick a teammate to start</span>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}