import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron-driven Zillow enrichment for home-tank list leads.
 * Called every few minutes by pg_cron with the project anon key in the `apikey` header.
 * Bounded per run so it always finishes inside the Worker request budget.
 */
export const Route = createFileRoute("/api/public/hooks/zillow-backfill")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { runZillowListLeadBackfill } = await import("@/lib/zillow.server");
          const result = await runZillowListLeadBackfill(25);
          return Response.json({ ok: true, ...result });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});