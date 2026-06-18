import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/AppShell";
import { CommissionsPanel } from "@/components/CommissionsPanel";

export const Route = createFileRoute("/commissions")({
  head: () => ({
    meta: [
      { title: "Commissions — LeadVault" },
      {
        name: "description",
        content: "Live commission tracking based on sold leads.",
      },
    ],
  }),
  component: CommissionsPage,
});

function CommissionsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  if (loading || !user) return null;

  return (
    <AppShell>
      <PageHeader
        title="Commission Hub"
        description="Live look at commissions based on sold leads in LeadVault."
      />
      <CommissionsPanel />
    </AppShell>
  );
}
