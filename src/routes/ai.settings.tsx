import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell, PageHeader } from "@/components/AppShell";
import { useHasRole } from "@/lib/auth";
import { getAiSettings, updateAiSettings } from "@/lib/ai-context.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/ai/settings")({
  head: () => ({ meta: [{ title: "AI Settings — LeadVault" }] }),
  component: AISettings,
});

function AISettings() {
  const isAdmin = useHasRole("admin");
  const nav = useNavigate();
  useEffect(() => { if (!isAdmin) nav({ to: "/" }); }, [isAdmin, nav]);

  const get = useServerFn(getAiSettings);
  const upd = useServerFn(updateAiSettings);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ai_settings"], queryFn: () => get() });
  const [goal, setGoal] = useState("200");
  const [target, setTarget] = useState("10");

  useEffect(() => {
    if (q.data) {
      setGoal(String((q.data as any).monthly_auto_goal ?? 200));
      setTarget(String(((q.data as any).close_rate_target ?? 0.1) * 100));
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => upd({ data: { monthly_auto_goal: Number(goal), close_rate_target: Number(target) / 100 } }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["ai_settings"] }); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  if (!isAdmin) return null;

  return (
    <AppShell>
      <PageHeader
        title="LeadVault AI Settings"
        description="Business rules used by AI projections and recommendations."
        action={
          <Link to="/ai">
            <Button variant="outline" size="sm"><ArrowLeft className="h-3.5 w-3.5" /> Back to AI</Button>
          </Link>
        }
      />
      <Card className="max-w-xl">
        <CardHeader><CardTitle className="text-sm">Goals</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="goal">Monthly auto sales goal</Label>
            <Input id="goal" type="number" value={goal} onChange={(e) => setGoal(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">Used by month-end projections and gap-to-goal calculations.</p>
          </div>
          <div>
            <Label htmlFor="target">Target close rate (%)</Label>
            <Input id="target" type="number" step="0.1" value={target} onChange={(e) => setTarget(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">Used to flag agents/vendors below target.</p>
          </div>
          <div className="pt-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}