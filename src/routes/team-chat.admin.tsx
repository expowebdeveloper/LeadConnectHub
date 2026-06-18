import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  adminListChannels,
  adminArchiveConversation,
  adminListAudit,
} from "@/lib/chat-stage2.functions";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hash, Lock, Archive, ArchiveRestore, Megaphone, ShieldAlert, ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/team-chat/admin")({
  ssr: false,
  component: ChatAdminPage,
});

function ChatAdminPage() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"channels" | "audit">("channels");

  useEffect(() => {
    if (!user) return;
    void supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .then(({ data }) => {
        setIsAdmin((data ?? []).some((r) => r.role === "admin"));
      });
  }, [user?.id]);

  useEffect(() => {
    document.title = "Chat Vault Admin — LeadVault";
  }, []);

  if (isAdmin === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="text-sm text-muted-foreground">Checking permissions…</div>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-background text-foreground">
        <ShieldAlert className="mb-3 h-8 w-8 text-destructive" />
        <div className="text-lg font-semibold">Admins only</div>
        <div className="mt-1 text-sm text-muted-foreground">You don't have access to Chat Vault Admin.</div>
        <Button className="mt-4" onClick={() => (window.location.href = "/team-chat")} variant="outline">
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to chat
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => (window.location.href = "/team-chat")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="text-sm font-semibold">Chat Vault — Admin</div>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-48 shrink-0 border-r border-border bg-sidebar p-2">
          <TabBtn active={tab === "channels"} onClick={() => setTab("channels")} icon={<Hash className="h-4 w-4" />}>
            Channels
          </TabBtn>
          <TabBtn active={tab === "audit"} onClick={() => setTab("audit")} icon={<Megaphone className="h-4 w-4" />}>
            Audit log
          </TabBtn>
        </aside>
        <main className="flex-1 overflow-auto p-6">
          {tab === "channels" ? <ChannelsTab /> : <AuditTab />}
        </main>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/40",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function ChannelsTab() {
  const qc = useQueryClient();
  const list = useServerFn(adminListChannels);
  const archive = useServerFn(adminArchiveConversation);
  const q = useQuery({ queryKey: ["admin.channels"], queryFn: () => list() });
  const channels = q.data?.channels ?? [];

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Channels & DMs</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Archive channels you don't need anymore. Archived channels are hidden from members but messages are preserved.
      </p>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Name</th>
              <th className="px-3 py-2 text-left font-semibold">Type</th>
              <th className="px-3 py-2 text-left font-semibold">Members</th>
              <th className="px-3 py-2 text-left font-semibold">Last activity</th>
              <th className="px-3 py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    {c.is_private ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> : <Hash className="h-3.5 w-3.5 text-muted-foreground" />}
                    {c.name ?? <span className="text-muted-foreground italic">DM</span>}
                    {c.archived_at && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">Archived</span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{c.type}</td>
                <td className="px-3 py-2 tabular-nums">{c.member_count}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {c.last_message_at ? format(new Date(c.last_message_at as string), "MMM d, h:mm a") : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        await archive({ data: { conversationId: c.id, archive: !c.archived_at } });
                        qc.invalidateQueries({ queryKey: ["admin.channels"] });
                        toast.success(c.archived_at ? "Restored" : "Archived");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Failed");
                      }
                    }}
                  >
                    {c.archived_at ? (
                      <>
                        <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" /> Restore
                      </>
                    ) : (
                      <>
                        <Archive className="mr-1.5 h-3.5 w-3.5" /> Archive
                      </>
                    )}
                  </Button>
                </td>
              </tr>
            ))}
            {channels.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                  No channels yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditTab() {
  const list = useServerFn(adminListAudit);
  const q = useQuery({ queryKey: ["admin.audit"], queryFn: () => list() });
  const entries = q.data?.entries ?? [];

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Audit log</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Last 200 admin actions across Chat Vault.
      </p>
      <ScrollArea className="h-[70vh] rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">When</th>
              <th className="px-3 py-2 text-left font-semibold">Actor</th>
              <th className="px-3 py-2 text-left font-semibold">Action</th>
              <th className="px-3 py-2 text-left font-semibold">Target</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-border">
                <td className="px-3 py-2 text-muted-foreground">
                  {format(new Date(e.created_at as string), "MMM d, h:mm a")}
                </td>
                <td className="px-3 py-2">{e.actor_name}</td>
                <td className="px-3 py-2 font-mono text-xs">{e.action}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {e.target_type ? `${e.target_type}:${e.target_id?.slice(0, 8)}…` : "—"}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-sm text-muted-foreground">
                  No audit entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}
