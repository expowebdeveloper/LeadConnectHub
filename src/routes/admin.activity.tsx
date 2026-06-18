import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/admin/activity")({
  head: () => ({
    meta: [
      { title: "Agent Activity — LeadVault" },
      { name: "description", content: "Per-agent action log." },
    ],
  }),
  component: RedirectToPerformance,
});

function RedirectToPerformance() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/analytics", search: { tab: "activity" } as any, replace: true });
  }, [navigate]);
  return null;
}
