import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth, useHasRole } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { searchLeads, type SearchHit } from "@/lib/search.functions";
import { PhoneLink } from "@/components/PhoneLink";
import { AgentAvatar } from "@/components/AgentAvatar";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";

export const Route = createFileRoute("/search")({
  validateSearch: zodValidator(
    z.object({
      q: fallback(z.string(), "").default(""),
    }),
  ),
  head: () => ({
    meta: [
      { title: "Search leads — LeadVault" },
      { name: "description", content: "Search every lead by name, phone, email, or location." },
    ],
  }),
  component: SearchPage,
});

function SearchPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { q: urlQ } = Route.useSearch();
  const debounced = (urlQ ?? "").trim();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  if (loading || !user) return null;

  return (
    <AppShell>
      <PageHeader title="Search" />
      <SearchPanel debounced={debounced} />
    </AppShell>
  );
}

function SearchPanel({ debounced }: { debounced: string }) {
  const fetchSearch = useServerFn(searchLeads);
  const { user } = useAuth();
  const isVendor = useHasRole("vendor");
  const navigate = useNavigate();

  const enabled = debounced.length >= 2;

  const resultsQ = useQuery({
    queryKey: ["lead-search", debounced],
    queryFn: () => fetchSearch({ data: { q: debounced, limit: 50 } }),
    enabled,
  });

  const rows: SearchHit[] = useMemo(() => resultsQ.data ?? [], [resultsQ.data]);

  const go = (r: SearchHit) => {
    if (isVendor) {
      navigate({ to: "/leads/$leadId", params: { leadId: r.id }, search: { source: r.source } });
      return;
    }
    const mine = !!user?.id && r.claimed_by === user.id;
    if (mine) {
      const sourceKey = r.source === "live" ? "leads" : "list_leads";
      navigate({ to: "/my-leads", search: { openLead: `${sourceKey}:${r.id}` } });
      return;
    }
    if (r.source === "list") {
      navigate({ to: "/shark-tank", search: { lead: r.id } });
      return;
    }
    navigate({ to: "/leads/$leadId", params: { leadId: r.id }, search: { source: r.source } });
  };

  return (
    <Card className="overflow-hidden rounded-2xl border-cyan-500/30 shadow-[0_0_60px_-10px_rgba(34,211,238,0.35)] bg-background/40">
      <CardContent className="p-0">
        {!enabled ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Type in the search box above (at least 2 characters) to find any lead.
          </div>
        ) : resultsQ.isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Searching…</div>
        ) : resultsQ.error ? (
          <div className="p-6 text-sm text-destructive">{(resultsQ.error as Error).message}</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No leads match "{debounced}".
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {rows.map((r) => (
              <li
                key={`${r.source}-${r.id}`}
                role="button"
                tabIndex={0}
                onClick={() => go(r)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    go(r);
                  }
                }}
                className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-cyan-500/5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-base font-semibold text-foreground">
                      {(r.first_name ?? "") + " " + (r.last_name ?? "")}
                    </span>
                    {r.source === "live" ? (
                      <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/40 px-1.5 py-0 text-[10px] uppercase">
                        Live
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-cyan-500/40 text-cyan-300 px-1.5 py-0 text-[10px] uppercase">
                        {r.list_type || "List"}
                      </Badge>
                    )}
                    {r.dispo && (
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px] uppercase">
                        {r.dispo}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    <span onClick={(e) => e.stopPropagation()}>
                      <PhoneLink phone={r.phone} leadId={r.id} leadSource={r.source} />
                    </span>
                    {" · "}
                    {[r.city, r.state, r.zip].filter(Boolean).join(", ") || "—"}
                    {r.email && <> · {r.email}</>}
                    {r.vendor_name && <> · {r.vendor_name}</>}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-muted-foreground">
                  {r.claimed_by ? (
                    <span className="inline-flex items-center gap-1.5">
                      <AgentAvatar size="xs" name={r.claimed_by_name} path={r.claimed_by_avatar_url} />
                      <span className="truncate">{r.claimed_by_name ?? "Claimed"}</span>
                    </span>
                  ) : (
                    <span className="text-cyan-400/70">Open</span>
                  )}
                  <div className="mt-0.5 tabular-nums">
                    {new Date(r.created_at).toLocaleDateString()}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}