import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { createDispute } from "@/lib/disputes.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_FILES = 6;

const REASONS = [
  { value: "valid_lead", label: "Lead was valid and should be billable" },
  { value: "wrong_dispo", label: "Disposition is incorrect" },
  { value: "claim_issue", label: "Lead was reachable but never claimed" },
  { value: "meets_criteria", label: "Lead meets vendor criteria (vehicles/age)" },
  { value: "other", label: "Other (explain below)" },
];

export function DisputeDialog({
  open,
  onOpenChange,
  leadId,
  source,
  reasons,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadId: string;
  source: "live" | "list";
  reasons: string[];
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const submitDispute = useServerFn(createDispute);

  const [category, setCategory] = useState<string>("");
  const [details, setDetails] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);

  const reset = () => {
    setCategory("");
    setDetails("");
    setFiles([]);
  };

  const m = useMutation({
    mutationFn: async () => {
      if (!category) throw new Error("Pick a reason");
      if (!user?.id) throw new Error("Not signed in");

      const uploaded: string[] = [];
      for (const f of files) {
        if (f.size > MAX_FILE_BYTES) throw new Error(`${f.name} exceeds 25MB`);
        const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${user.id}/${leadId}/${Date.now()}-${safe}`;
        const { error } = await supabase.storage
          .from("dispute-evidence")
          .upload(path, f, { upsert: false, contentType: f.type || undefined });
        if (error) throw new Error(`Upload failed: ${error.message}`);
        uploaded.push(path);
      }

      return submitDispute({
        data: {
          leadId,
          source,
          reasonCategory: category,
          reasonDetails: details || null,
          evidencePaths: uploaded,
          asUserId: user.id,
        },
      });
    },
    onSuccess: () => {
      toast.success("Dispute submitted");
      qc.invalidateQueries({ queryKey: ["vendor-payments"] });
      qc.invalidateQueries({ queryKey: ["my-disputes"] });
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!m.isPending) onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise a billing dispute</DialogTitle>
          <DialogDescription>
            Tell us why this lead should be reviewed. Attach a call recording or any supporting files.
          </DialogDescription>
        </DialogHeader>

        {reasons.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <div className="mb-1 font-medium">Marked non-billable because:</div>
            <ul className="list-disc pl-4 text-muted-foreground">
              {reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <Label>Reason</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue placeholder="Choose a reason…" /></SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="dispute-details">Details</Label>
            <Textarea
              id="dispute-details"
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, 2000))}
              placeholder="Add any context that helps us review this lead…"
              rows={4}
            />
          </div>
          <div>
            <Label htmlFor="dispute-files">Evidence (call recordings, screenshots, PDFs)</Label>
            <Input
              id="dispute-files"
              type="file"
              multiple
              accept="audio/*,image/*,application/pdf,.mp3,.wav,.m4a"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                setFiles((prev) => [...prev, ...list].slice(0, MAX_FILES));
                e.target.value = "";
              }}
            />
            {files.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between rounded border px-2 py-1">
                    <span className="truncate">{f.name} · {(f.size / 1024 / 1024).toFixed(1)} MB</span>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Remove file"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-muted-foreground">Up to {MAX_FILES} files, 25MB each.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={m.isPending}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} disabled={!category || m.isPending}>
            {m.isPending ? "Submitting…" : "Submit dispute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}