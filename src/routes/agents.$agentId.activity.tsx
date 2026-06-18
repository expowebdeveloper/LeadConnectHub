import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AppShell, PageHeader } from "@/components/AppShell";
import { AgentActivityPanel } from "@/components/AgentActivityPanel";
import { ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/agents/$agentId/activity")({
  head: () => ({
    meta: [
      { title: "Agent Activity — LeadVault" },
      { name: "description", content: "Per-agent activity log." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    tab: z.enum(["activity", "sales"]).safeParse(s.tab).data ?? "activity",
    range: z.enum(["day", "week", "month", "custom"]).safeParse(s.range).data ?? "week",
  }),
  component: AgentActivityPage,
});

function AgentActivityPage() {
  const { agentId } = Route.useParams();
  const { tab, range } = Route.useSearch();

  return (
    <AppShell>
      <PageHeader
        title={tab === "sales" ? "Agent Sales" : "Agent Activity"}
        description={tab === "sales" ? "Sold leads for this agent." : "Detailed action log for this agent."}
        action={
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
        }
      />
      <AgentActivityPanel initialAgentId={agentId} hideAgentPicker initialTab={tab} initialRange={range} />
    </AppShell>
  );
}
