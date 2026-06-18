import { Link, useRouterState } from "@tanstack/react-router";
import { useHasRole } from "@/lib/auth";
import { Sparkles } from "lucide-react";

export function AIFloatingButton() {
  const isAdmin = useHasRole("admin");
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (!isAdmin) return null;
  if (path.startsWith("/ai")) return null;
  if (path.startsWith("/auth")) return null;
  return (
    <Link
      to="/ai"
      className="group fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Open LeadVault AI"
      title="LeadVault AI (admin)"
    >
      <Sparkles className="h-5 w-5" />
      <span className="pointer-events-none absolute right-14 hidden whitespace-nowrap rounded-md border border-border/60 bg-popover px-2 py-1 text-xs text-popover-foreground shadow group-hover:block">
        LeadVault AI
      </span>
    </Link>
  );
}