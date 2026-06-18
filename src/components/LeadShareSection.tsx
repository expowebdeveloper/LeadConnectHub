import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listSalesAgents } from "@/lib/admin.functions";
import { useHasRole } from "@/lib/auth";
import { toast } from "sonner";
import { Users2 } from "lucide-react";

export function LeadShareSection({
  leadId,
  leadTable,
  claimedBy,
  uid,
  canManage = true,
}: {
  leadId: string;
  leadTable: "leads" | "list_leads";
  claimedBy: string | null;
  uid: string;
  /** When false, hides the share picker (still shows existing shares). */
  canManage?: boolean;
}) {
  const qc = useQueryClient();
  const isClaimer = !!uid && claimedBy === uid;
  const isAdmin = useHasRole("admin");
  const fetchAgents = useServerFn(listSalesAgents);
  const [pickerVal, setPickerVal] = useState("");

  const sharesQ = useQuery({
    queryKey: ["lead-shares", leadTable, leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_shares")
        .select("id, shared_with, shared_by, created_at")
        .eq("lead_id", leadId)
        .eq("lead_table", leadTable);
      if (error) throw error;
      return data ?? [];
    },
  });

  const agentsQ = useQuery({
    queryKey: ["sales-agents"],
    queryFn: () => fetchAgents(),
  });

  const agentName = (id: string) => {
    const a = (agentsQ.data ?? []).find((x) => x.id === id);
    return a ? (a.full_name || a.email) : id.slice(0, 8);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["lead-shares", leadTable, leadId] });
    qc.invalidateQueries({ queryKey: ["my-leads-shared"] });
  };

  const addM = useMutation({
    mutationFn: async (agentId: string) => {
      const { error } = await supabase.from("lead_shares").insert({
        lead_id: leadId,
        lead_table: leadTable,
        shared_with: agentId,
        shared_by: uid,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lead shared");
      setPickerVal("");
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
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to remove share"),
  });

  const shares = sharesQ.data ?? [];
  const sharedIds = new Set(shares.map((s) => s.shared_with));
  const availableAgents = (agentsQ.data ?? []).filter(
    (a) => a.id !== uid && a.id !== claimedBy && !sharedIds.has(a.id),
  );

  const showPicker = canManage && (isClaimer || isAdmin);

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Users2 className="h-4 w-4 text-muted-foreground" />
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Shared with
        </div>
      </div>

      {shares.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {showPicker
            ? "Not shared with anyone yet."
            : isClaimer
              ? "Not shared with anyone yet."
              : claimedBy
                ? "Only the lead owner can share this lead."
                : "Claim this lead to share it with another agent."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {shares.map((s) => {
            const canRemove = isClaimer || isAdmin || s.shared_with === uid;
            return (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded border bg-muted/30 px-2.5 py-1.5 text-sm">
                <span className="truncate">{agentName(s.shared_with)}</span>
                {canRemove && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => removeM.mutate(s.id)}
                    disabled={removeM.isPending}
                  >
                    {s.shared_with === uid && !isClaimer ? "Leave" : "Remove"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {showPicker && (
        <div className="flex items-center gap-2">
          <Select
            value={pickerVal}
            onValueChange={(v) => {
              setPickerVal(v);
              addM.mutate(v);
            }}
            disabled={availableAgents.length === 0 || addM.isPending}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={availableAgents.length === 0 ? "No other agents available" : "Share with agent…"} />
            </SelectTrigger>
            <SelectContent>
              {availableAgents.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.full_name || a.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}