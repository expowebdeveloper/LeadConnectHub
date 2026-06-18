import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { listSalesAgents } from "@/lib/admin.functions";
import { toast } from "sonner";
import { UserPlus, UserCheck, UserX, X, ArrowRightLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";

type LeadTable = "leads" | "list_leads";

export type AgentLite = {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url?: string | null;
};

/**
 * Unified per-line owner control. The avatar is the trigger;
 * clicking opens a popover with claim / unclaim / reassign / share actions.
 */
export function LineOwnerControl({
  leadId,
  leadTable,
  lineId,
  claimedBy,
  currentUserId,
  isAdmin,
  agents,
  onToggleClaim,
  onReassign,
  disabled,
}: {
  leadId: string;
  leadTable: LeadTable;
  lineId: "auto" | "home";
  claimedBy: string | null;
  currentUserId: string;
  isAdmin: boolean;
  /** Optional preloaded agent list; if absent, the popover will fetch on open. */
  agents?: AgentLite[];
  onToggleClaim: (next: boolean) => void;
  /** Admin reassign — assign this line to another agent (or null to release). */
  onReassign?: (agentId: string | null) => void;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const fetchAgents = useServerFn(listSalesAgents);
  // While an admin is impersonating another user, useAuth().user.id is the
  // impersonated id but auth.uid() server-side is still the real admin.
  // RLS requires shared_by = auth.uid(), so use the real session user id
  // for the insert.
  const { realUser } = useAuth();
  const sessionUid = realUser?.id ?? currentUserId;
  const [open, setOpen] = useState(false);
  const [shareQuery, setShareQuery] = useState("");
  const [reassignQuery, setReassignQuery] = useState("");

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setShareQuery("");
      setReassignQuery("");
      // Safety net: clear any stuck Radix pointer-events lock on <body>.
      if (typeof document !== "undefined") {
        document.body.style.pointerEvents = "";
      }
    }
  };

  const claimedByMe = !!claimedBy && claimedBy === currentUserId;
  const claimedByOther = !!claimedBy && claimedBy !== currentUserId;
  const isClaimer = claimedByMe;
  const canManage = isAdmin || isClaimer || !claimedBy;

  // Agents — prefer the preloaded list; otherwise lazy-fetch when popover opens.
  const agentsQ = useQuery({
    queryKey: ["sales-agents"],
    queryFn: () => fetchAgents(),
    enabled: open && (!agents || agents.length === 0),
    initialData: agents,
  });
  const allAgents: AgentLite[] = agentsQ.data ?? agents ?? [];
  const agentById = (id: string | null | undefined) =>
    id ? allAgents.find((a) => a.id === id) : undefined;

  const ownerAgent = agentById(claimedBy);
  const ownerName =
    ownerAgent?.full_name || ownerAgent?.email || (claimedBy ? "another agent" : "Unclaimed");

  // Shares
  const sharesQ = useQuery({
    queryKey: ["line-shares", leadTable, leadId, lineId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_shares")
        .select("id, shared_with, shared_by, line_id")
        .eq("lead_id", leadId)
        .eq("lead_table", leadTable)
        .eq("line_id", lineId);
      if (error) throw error;
      return data ?? [];
    },
  });
  const shares = sharesQ.data ?? [];
  const sharedIds = new Set(shares.map((s) => s.shared_with));
  const isSharerOnThisLine = shares.some(
    (s) => s.shared_by === sessionUid || s.shared_by === currentUserId,
  );
  const canAddShare = canManage || isSharerOnThisLine;

  const invalidateShares = () => {
    qc.invalidateQueries({ queryKey: ["line-shares", leadTable, leadId, lineId] });
    qc.invalidateQueries({ queryKey: ["my-leads-shared"] });
  };

  const addShareM = useMutation({
    mutationFn: async (agentId: string) => {
      if (!sessionUid) throw new Error("Not signed in");
      if (agentId === sessionUid) throw new Error("You can't share with yourself");
      const { error } = await supabase.from("lead_shares").insert({
        lead_id: leadId,
        lead_table: leadTable,
        line_id: lineId,
        shared_with: agentId,
        shared_by: sessionUid,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Line shared");
      invalidateShares();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to share"),
  });

  const removeShareM = useMutation({
    mutationFn: async (shareId: string) => {
      const { error } = await supabase.from("lead_shares").delete().eq("id", shareId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Share removed");
      invalidateShares();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to remove"),
  });

  // Trigger avatar — same look as the previous ClaimPill avatar.
  const triggerLabel = claimedByMe
    ? "Claimed by you — manage"
    : claimedByOther
      ? `Claimed by ${ownerName} — manage`
      : "Claim or share";

  const norm = (s: string) => s.toLowerCase();
  const matches = (a: AgentLite, q: string) => {
    const needle = norm(q.trim());
    if (!needle) return true;
    return (
      norm(a.full_name ?? "").includes(needle) ||
      norm(a.email ?? "").includes(needle)
    );
  };

  const reassignCandidates = useMemo(
    () => allAgents.filter((a) => a.id !== claimedBy && matches(a, reassignQuery)),
    [allAgents, claimedBy, reassignQuery],
  );

  const shareCandidates = useMemo(
    () =>
      allAgents.filter(
        (a) =>
          a.id !== currentUserId &&
          a.id !== sessionUid &&
          a.id !== claimedBy &&
          !sharedIds.has(a.id) &&
          matches(a, shareQuery),
      ),
    [allAgents, currentUserId, sessionUid, claimedBy, sharedIds, shareQuery],
  );

  // When unclaimed but shared: promote the first share to the main trigger
  // so the small dashed placeholder and the overlay avatar don't visually collide.
  const firstShareAgent = !claimedBy && shares.length > 0 ? agentById(shares[0].shared_with) : undefined;
  const firstShareName =
    firstShareAgent?.full_name || firstShareAgent?.email || "Shared agent";
  const extraShareCount = !claimedBy ? Math.max(0, shares.length - 1) : 0;
  const unclaimedSharedLabel = !claimedBy && shares.length > 0
    ? `Shared with ${firstShareName}${extraShareCount > 0 ? ` +${extraShareCount} more` : ""} — unclaimed, click to claim or manage`
    : null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={unclaimedSharedLabel ?? triggerLabel}
          aria-label={unclaimedSharedLabel ?? triggerLabel}
          className={`relative inline-flex shrink-0 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
            claimedByMe
              ? "ring-2 ring-cyan-400/80 ring-offset-2 ring-offset-background shadow-[0_0_10px_rgba(34,211,238,0.35)] hover:ring-cyan-300"
              : claimedByOther
                ? "ring-1 ring-border/60 hover:ring-border"
                : "hover:opacity-90"
          }`}
        >
          {claimedBy ? (
            <AgentAvatar
              size="sm"
              name={ownerName}
              path={ownerAgent?.avatar_url ?? null}
            />
          ) : firstShareAgent ? (
            <AgentAvatar
              size="sm"
              name={firstShareName}
              path={firstShareAgent.avatar_url ?? null}
            />
          ) : (
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 bg-muted/20 text-muted-foreground hover:border-cyan-400/60 hover:text-cyan-300">
              <UserPlus className="h-3 w-3" />
            </span>
          )}
          {claimedBy && shares.length > 0 && (
            <span className="absolute -bottom-1 -right-1 flex items-center -space-x-1">
              {shares.slice(0, 2).map((s) => {
                const a = agentById(s.shared_with);
                const name = a?.full_name || a?.email || "Shared agent";
                return (
                  <span
                    key={s.id}
                    title={`Shared with ${name}`}
                    className="rounded-full ring-2 ring-background"
                  >
                    <AgentAvatar size="xs" name={name} path={a?.avatar_url ?? null} />
                  </span>
                );
              })}
              {shares.length > 2 && (
                <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full ring-2 ring-background bg-cyan-500 px-1 text-[8px] font-bold text-background">
                  +{shares.length - 2}
                </span>
              )}
            </span>
          )}
          {!claimedBy && extraShareCount > 0 && (
            <span className="absolute -bottom-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full ring-2 ring-background bg-cyan-500 px-1 text-[8px] font-bold text-background">
              +{extraShareCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="z-[60] w-72 p-0">
        {/* Owner */}
        <div className="flex items-center gap-3 border-b border-border/60 p-3">
          {claimedBy ? (
            <AgentAvatar
              size="md"
              name={ownerName}
              path={ownerAgent?.avatar_url ?? null}
            />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 bg-muted/20 text-muted-foreground">
              <UserPlus className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {lineId === "home" ? "Home owner" : "Auto owner"}
            </div>
            <div className="truncate text-sm font-semibold text-foreground">
              {claimedByMe ? "You" : ownerName}
            </div>
          </div>
          {canManage && (
            claimedByMe ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => {
                  onToggleClaim(false);
                  handleOpenChange(false);
                }}
              >
                <UserX className="h-3.5 w-3.5" /> Unclaim
              </Button>
            ) : !claimedBy ? (
              <Button
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => {
                  onToggleClaim(true);
                  handleOpenChange(false);
                }}
              >
                <UserCheck className="h-3.5 w-3.5" /> Claim
              </Button>
            ) : isAdmin ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => {
                  onReassign?.(null);
                  handleOpenChange(false);
                }}
              >
                <UserX className="h-3.5 w-3.5" /> Release
              </Button>
            ) : null
          )}
        </div>

        {/* Reassign — admin only */}
        {isAdmin && onReassign && (
          <div className="border-b border-border/60 p-2">
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <ArrowRightLeft className="h-3 w-3" /> Reassign to
              </span>
            </div>
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search agents…"
                className="h-8"
                value={reassignQuery}
                onValueChange={setReassignQuery}
                autoFocus
              />
              <CommandList className="max-h-40">
                <CommandEmpty>{agentsQ.isLoading ? "Loading…" : "No agents"}</CommandEmpty>
                <CommandGroup>
                  {reassignCandidates.map((a) => (
                      <CommandItem
                        key={a.id}
                        value={`${a.full_name ?? ""} ${a.email ?? ""}`}
                        onSelect={() => {
                          onReassign(a.id);
                          handleOpenChange(false);
                        }}
                      >
                        <AgentAvatar
                          size="xs"
                          name={a.full_name || a.email}
                          path={a.avatar_url}
                          className="mr-2"
                        />
                        <span className="truncate">{a.full_name || a.email}</span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        )}

        {/* Shares */}
        <div className="p-2">
          <div className="flex items-center justify-between px-2 pb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Shared with
            </span>
            {shares.length > 0 && (
              <span className="text-[10px] text-muted-foreground">{shares.length}</span>
            )}
          </div>
          {shares.length === 0 ? (
            <div className="px-2 pb-1 text-xs text-muted-foreground">No one yet.</div>
          ) : (
            <ul className="mb-1 space-y-1 px-1">
              {shares.map((s) => {
                const a = agentById(s.shared_with);
                const name = a?.full_name || a?.email || s.shared_with.slice(0, 8);
                const canRemove =
                  canManage ||
                  s.shared_with === currentUserId ||
                  s.shared_by === currentUserId ||
                  s.shared_by === sessionUid;
                return (
                  <li
                    key={s.id}
                    className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/40"
                  >
                    <AgentAvatar size="xs" name={name} path={a?.avatar_url ?? null} />
                    <span className="flex-1 truncate text-xs">{name}</span>
                    {canRemove && (
                      <button
                        type="button"
                        onClick={() => removeShareM.mutate(s.id)}
                        className="opacity-0 transition group-hover:opacity-100"
                        aria-label={`Unshare ${name}`}
                        title={`Unshare ${name}`}
                      >
                        <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {canAddShare && (
            <Command shouldFilter={false} className="rounded-md border border-border/60">
              <CommandInput
                placeholder="Add teammate…"
                className="h-8"
                value={shareQuery}
                onValueChange={setShareQuery}
                autoFocus
              />
              <CommandList className="max-h-40">
                <CommandEmpty>
                  {agentsQ.isLoading ? "Loading…" : "No teammates available"}
                </CommandEmpty>
                <CommandGroup>
                  {shareCandidates.map((a) => (
                      <CommandItem
                        key={a.id}
                        value={`${a.full_name ?? ""} ${a.email ?? ""}`}
                        onSelect={() => {
                          addShareM.mutate(a.id);
                          setShareQuery("");
                        }}
                      >
                        <AgentAvatar
                          size="xs"
                          name={a.full_name || a.email}
                          path={a.avatar_url}
                          className="mr-2"
                        />
                        <span className="truncate">{a.full_name || a.email}</span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              </CommandList>
            </Command>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
