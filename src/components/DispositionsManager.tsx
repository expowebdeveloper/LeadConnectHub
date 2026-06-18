import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  addDispoOption,
  deleteDispoOption,
  listDispoOptions,
  updateDispoOption,
} from "@/lib/dispos.functions";

export function DispositionsManager() {
  const qc = useQueryClient();
  const fetchAll = useServerFn(listDispoOptions);
  const updateOne = useServerFn(updateDispoOption);
  const addOne = useServerFn(addDispoOption);
  const deleteOne = useServerFn(deleteDispoOption);

  const q = useQuery({
    queryKey: ["dispo-options"],
    queryFn: () => fetchAll(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["dispo-options"] });

  const updateM = useMutation({
    mutationFn: (input: {
      value: string;
      label?: string;
      sort_order?: number;
      enabled?: boolean;
    }) => updateOne({ data: input }),
    onSuccess: () => {
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const deleteM = useMutation({
    mutationFn: (value: string) => deleteOne({ data: { value } }),
    onSuccess: (res) => {
      toast.success(res.mode === "deleted" ? "Removed" : "Hidden");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");
  const addM = useMutation({
    mutationFn: () =>
      addOne({
        data: {
          value: newValue || newLabel,
          label: newLabel,
          sort_order: 100,
        },
      }),
    onSuccess: () => {
      toast.success("Disposition added");
      setNewLabel("");
      setNewValue("");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (q.isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Loading…
        </CardContent>
      </Card>
    );
  }
  if (q.error) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-destructive">
          {(q.error as Error).message}
        </CardContent>
      </Card>
    );
  }

  const rows = q.data ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-medium">Add a new disposition</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="new-label">Label</Label>
              <Input
                id="new-label"
                placeholder="e.g. Already Has Allstate"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-value">Internal value (optional)</Label>
              <Input
                id="new-value"
                placeholder="auto-derived from label"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
              />
            </div>
            <Button
              onClick={() => addM.mutate()}
              disabled={!newLabel.trim() || addM.isPending}
            >
              {addM.isPending ? "Adding…" : "Add"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Once added, a disposition can be hidden but not fully deleted if any
            historical leads already use it.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="w-24">Order</TableHead>
                <TableHead className="w-24">Enabled</TableHead>
                <TableHead className="w-24">Type</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <DispoRow
                  key={r.value}
                  row={r}
                  onSave={(patch) => updateM.mutate({ value: r.value, ...patch })}
                  onDelete={() => deleteM.mutate(r.value)}
                  pending={updateM.isPending || deleteM.isPending}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function DispoRow({
  row,
  onSave,
  onDelete,
  pending,
}: {
  row: {
    value: string;
    label: string;
    sort_order: number;
    enabled: boolean;
    is_system: boolean;
  };
  onSave: (patch: { label?: string; sort_order?: number; enabled?: boolean }) => void;
  onDelete: () => void;
  pending: boolean;
}) {
  const [label, setLabel] = useState(row.label);
  const [order, setOrder] = useState(String(row.sort_order));

  useEffect(() => {
    setLabel(row.label);
    setOrder(String(row.sort_order));
  }, [row.label, row.sort_order]);

  const dirty =
    label.trim() !== row.label || Number(order) !== row.sort_order;

  return (
    <TableRow>
      <TableCell>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="h-8"
        />
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {row.value}
      </TableCell>
      <TableCell>
        <Input
          type="number"
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          className="h-8 w-20"
        />
      </TableCell>
      <TableCell>
        <Switch
          checked={row.enabled}
          onCheckedChange={(v) => onSave({ enabled: v })}
          disabled={pending}
        />
      </TableCell>
      <TableCell>
        {row.is_system ? (
          <Badge variant="secondary">System</Badge>
        ) : (
          <Badge variant="outline">Custom</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!dirty || pending || !label.trim()}
            onClick={() =>
              onSave({ label: label.trim(), sort_order: Number(order) || 100 })
            }
          >
            Save
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive" disabled={pending}>
                {row.is_system ? "Hide" : "Remove"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {row.is_system ? "Hide this disposition?" : "Remove this disposition?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {row.is_system
                    ? "Agents will no longer see it in the dropdown. Existing leads tagged with it stay unchanged and the badge still renders."
                    : "Removes this option from the picker. Existing leads tagged with this value will keep the raw value as their label."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {row.is_system ? "Hide" : "Remove"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
  );
}
