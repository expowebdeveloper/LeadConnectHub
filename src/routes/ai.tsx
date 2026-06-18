import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { useHasRole, useAuth } from "@/lib/auth";
import { AIWorkspace } from "@/components/ai/AIWorkspace";
import { toast } from "sonner";

export const Route = createFileRoute("/ai")({
  head: () => ({
    meta: [
      { title: "LeadVault AI — CRM Intelligence" },
      { name: "description", content: "Admin AI assistant for CRM data: KPIs, forecasts, agent and vendor analysis, recommendations." },
    ],
  }),
  component: AIPage,
});

function AIPage() {
  const isAdmin = useHasRole("admin");
  const { loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !isAdmin) {
      toast.error("LeadVault AI is admin only.");
      navigate({ to: "/" });
    }
  }, [loading, isAdmin, navigate]);

  if (!isAdmin) return null;

  return (
    <AppShell fullBleed>
      <AIWorkspace />
    </AppShell>
  );
}