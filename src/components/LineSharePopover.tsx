import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "@/components/AgentAvatar";
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
import { useAuth, useHasRole } from "@/lib/auth";
import { toast } from "sonner";
import { UserPlus2, X } from "lucide-react";

type LeadTable = "leads" | "list_leads";

/**
 * Compact per-line share control. Sits next to a line's claim switch.
 * - Shows an avatar stack of teammates the line is shared with (click X to unshare).
 * - Admin + the line's claimer can add new shares; everyone else just sees the stack.
 */
export function LineSharePopover({
  leadId,
  leadTable,
  lineId,
  lineClaimedBy,
  uid,
}: {
  leadId: string;
  leadTable: LeadTable;
  lineId: string;
  lineClaimedBy: string | null;
  uid: string | null;
}) {
  const qc = useQueryClient();
  // RLS requires shared_by = auth.uid(). When an admin is impersonating
  // another user, useAuth().user.id is the impersonated id, so we must use
  // the real session user for the insert (and for the admin check).
  const { realUser, realRoles } = useAuth();
  const impersonatedAdmin = useHasRole("admin");
  const sessionUid = realUser?.id ?? uid ?? null;
  const isAdmin = impersonatedAdmin || (realRoles ?? []).includes("admin");
  const isClaimer =
    (!!sessionUid && lineClaimedBy === sessionUid) ||
    (!!uid && lineClaimedBy === uid);
  const canManage = isAdmin || isClaimer;
  const fetchAgents = useServerFn(listSalesAgents);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      // Safety net for stuck Radix pointer-events lock on <body>.
      setTimeout(() => {
        if (typeof document !== "undefined" && document.body.style.pointerEvents === "none") {
          document.body.style.pointerEvents = "";
        }
      }, 0);
    }
  };

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

  const agentsQ = useQuery({
    queryKey: ["sales-agents"],
    queryFn: () => fetchAgents(),
    enabled: open,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["line-shares", leadTable, leadId, lineId] });
    qc.invalidateQueries({ queryKey: ["my-leads-shared"] });
  };

  const addM = useMutation({
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
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to share"),
  });

  const removeM = useMutation({
    mutationFn: async (shareId: string) => {
      const { error } = await supabase.from("lead_shares").delete().eq("id", shareId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Share removed");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to remove"),
  });

  const shares = sharesQ.data ?? [];
  const agents = agentsQ.data ?? [];
  const agentById = (id: string) => agents.find((a) => a.id === id);
  const sharedIds = new Set(shares.map((s) => s.shared_with));
  const isSharerOnThisLine = shares.some(
    (s) => s.shared_by === sessionUid || s.shared_by === uid,
  );
  const canAddShare = canManage || isSharerOnThisLine;
  const availableAgents = agents.filter(
    (a) =>
      a.id !== sessionUid &&
      a.id !== uid &&
      a.id !== lineClaimedBy &&
      !sharedIds.has(a.id),
  );
  const q = query.trim().toLowerCase();
  const filteredAgents = q
    ? availableAgents.filter((a) => {
        const name = (a.full_name ?? "").toLowerCase();
        const email = (a.email ?? "").toLowerCase();
        return name.includes(q) || email.includes(q);
      })
    : availableAgents;

  // Avatar stack (renders even when not manager).
  const stack = shares.length > 0 && (
    <div className="flex -space-x-2">
      {shares.slice(0, 3).map((s) => {
        const a = agentById(s.shared_with);
        const name = a?.full_name || a?.email || s.shared_with.slice(0, 8);
        const canRemove =
          canManage ||
          s.shared_with === uid ||
          s.shared_by === uid ||
          s.shared_by === sessionUid;
        return (
          <div key={s.id} className="group relative">
            <div title={name} className="rounded-full border-2 border-background">
              <AgentAvatar name={name} path={a?.avatar_url ?? null} size="sm" />
            </div>
            {canRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeM.mutate(s.id);
                }}
                className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow group-hover:flex"
                aria-label={`Unshare ${name}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        );
      })}
      {shares.length > 3 && (
        <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-semibold text-muted-foreground">
          +{shares.length - 3}
        </div>
      )}
    </div>
  );

  if (!canAddShare) {
    return stack ? <div className="flex items-center">{stack}</div> : null;
  }

  return (
    <div className="flex items-center gap-1.5">
      {stack}
      <Popover open={open} onOpenChange={handleOpenChange} modal>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            title="Share this line"
            onClick={(e) => e.stopPropagation()}
          >
            <UserPlus2 className="h-3.5 w-3.5" />
            <span>Share</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="z-[60] w-72 p-0">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search teammates…"
              value={query}
              onValueChange={setQuery}
              autoFocus
            />
            <CommandList>
              <CommandEmpty>
                {agentsQ.isLoading ? "Loading…" : "No teammates available"}
              </CommandEmpty>
              <CommandGroup>
                {filteredAgents.map((a) => (
                  <CommandItem
                    key={a.id}
                    value={`${a.full_name ?? ""} ${a.email ?? ""}`}
                    onSelect={() => {
                      addM.mutate(a.id);
                      handleOpenChange(false);
                    }}
                  >
                    <AgentAvatar
                      name={a.full_name || a.email || "?"}
                      path={a.avatar_url}
                      size="xs"
                      className="mr-2"
                    />
                    <span className="truncate">{a.full_name || a.email}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}