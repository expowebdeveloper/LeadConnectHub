import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth, useHasRole } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { DispositionsManager } from "@/components/DispositionsManager";

export const Route = createFileRoute("/admin/dispos")({
  head: () => ({
    meta: [
      { title: "Dispositions — LeadVault" },
      { name: "description", content: "Manage call-outcome dispositions." },
    ],
  }),
  component: AdminDisposPage,
});

function AdminDisposPage() {
  const { user, loading } = useAuth();
  const isAdmin = useHasRole("admin");
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  if (loading || !user) return null;

  return (
    <AppShell>
      <PageHeader
        title="Dispositions"
        description="Add, rename, reorder, or hide the call outcomes agents can pick."
      />
      {!isAdmin ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Admin access required.
          </CardContent>
        </Card>
      ) : (
        <DispositionsManager />
      )}
    </AppShell>
  );
}
