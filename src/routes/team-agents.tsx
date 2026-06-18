import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell, PageHeader } from "@/components/AppShell";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAuth, useHasRole } from "@/lib/auth";
import {
  listTeamAgents,
  createTeamInvite,
  revokeTeamInvite,
  removeTeamAgent,
} from "@/lib/vendor-team.functions";
import { Copy, Trash2, UserPlus, ShieldOff } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/team-agents")({
  head: () => ({
    meta: [
      { title: "Team agents — LeadVault" },
      {
        name: "description",
        content:
          "Invite agents to submit leads under your vendor account. Agents cannot see your revenue or analytics.",
      },
    ],
  }),
  component: TeamAgentsPage,
});

function TeamAgentsPage() {
  const { user, loading, isSubAgent } = useAuth();
  const navigate = useNavigate();
  const isVendor = useHasRole("vendor");
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchTeam = useServerFn(listTeamAgents);
  const createInvite = useServerFn(createTeamInvite);
  const revoke = useServerFn(revokeTeamInvite);
  const unlink = useServerFn(removeTeamAgent);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  const enabled = !!user && isVendor && !isSubAgent;
  const { data, isLoading } = useQuery({
    queryKey: ["team-agents"],
    queryFn: () => fetchTeam(),
    enabled,
  });

  if (loading || !user) return null;

  if (!isVendor || isSubAgent) {
    return (
      <AppShell>
        <PageHeader title="Team agents" />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Only vendor accounts can invite team agents.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const inviteUrl = (token: string) =>
    `${window.location.origin}/auth?invite=${token}`;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await createInvite({ data: { label } });
      setLabel("");
      toast.success("Invite link created");
      qc.invalidateQueries({ queryKey: ["team-agents"] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (token: string) => {
    await navigator.clipboard.writeText(inviteUrl(token));
    toast.success("Invite link copied");
  };

  const handleRevoke = async (id: string) => {
    await revoke({ data: { id } });
    toast.success("Invite revoked");
    qc.invalidateQueries({ queryKey: ["team-agents"] });
  };

  const handleUnlink = async (agentId: string) => {
    if (!confirm("Remove this agent? They can no longer submit leads under your account.")) return;
    await unlink({ data: { agent_id: agentId } });
    toast.success("Agent removed");
    qc.invalidateQueries({ queryKey: ["team-agents"] });
  };

  return (
    <AppShell>
      <PageHeader
        title="Team agents"
        description="Invite agents to submit leads under your vendor account. They will not see analytics, revenue, or payouts."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Create invite link
            </CardTitle>
            <CardDescription>
              Share this one-time link with an agent. When they sign up they will
              be approved automatically as a sub-account under your vendor profile.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="invite-label">Label (optional)</Label>
                <Input
                  id="invite-label"
                  placeholder="e.g. Maria – Day shift"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={80}
                />
              </div>
              <Button type="submit" disabled={creating}>
                {creating ? "Creating…" : "Generate invite link"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What sub-agents can do</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>✅ Submit new leads (attributed to your vendor account).</p>
            <p>✅ See the live leads board.</p>
            <p className="text-foreground">🚫 Cannot see Analytics, revenue, lead cost, or payouts.</p>
            <p className="text-foreground">🚫 Cannot invite other agents or change settings.</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Active invite links</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (data?.invites ?? []).filter((i) => !i.used_by).length === 0 ? (
            <div className="text-sm text-muted-foreground">No active invites.</div>
          ) : (
            <ul className="divide-y">
              {(data!.invites ?? [])
                .filter((i) => !i.used_by)
                .map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        {inv.label || "Untitled invite"}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {inviteUrl(inv.token)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Expires {new Date(inv.expires_at).toLocaleDateString()}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => handleCopy(inv.token)}>
                      <Copy className="h-4 w-4" />
                      Copy
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleRevoke(inv.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Your team agents</CardTitle>
          <CardDescription>
            Leads submitted by these agents are attributed to your vendor account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (data?.agents ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">No agents yet.</div>
          ) : (
            <ul className="divide-y">
              {data!.agents.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3">
                    <AgentAvatar name={a.full_name || a.email} path={(a as { avatar_url?: string | null }).avatar_url} size="lg" />
                    <div>
                      <div className="text-sm font-medium">{a.full_name || a.email}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">Sub-agent</Badge>
                    <Button size="sm" variant="ghost" onClick={() => handleUnlink(a.id)}>
                      <ShieldOff className="h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}