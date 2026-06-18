import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { ChatWorkspace } from "@/components/chat/ChatWorkspace";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { useIsMobile } from "@/hooks/use-mobile";

type Search = { c?: string; compose?: "dm" | "group" | "channel"; popout?: "1" };

export const Route = createFileRoute("/team-chat")({
  head: () => ({
    meta: [
      { title: "Team Chat — LeadVault" },
      { name: "description", content: "Internal team communication for LeadVault." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): Search => ({
    c: typeof search.c === "string" ? search.c : undefined,
    compose:
      search.compose === "dm" || search.compose === "group" || search.compose === "channel"
        ? search.compose
        : undefined,
    popout: search.popout === "1" ? "1" : undefined,
  }),
  component: TeamChatPage,
});

function TeamChatPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const search = useSearch({ from: "/team-chat" }) as Search;
  const selectedId = search.c ?? null;
  const isPopout = search.popout === "1";
  const setSelectedId = (id: string | null) => {
    void navigate({
      to: "/team-chat",
      search: { ...(id ? { c: id } : {}), ...(isPopout ? { popout: "1" as const } : {}) },
      replace: true,
    });
  };

  useEffect(() => {
    if (!loading && !user) {
      void navigate({ to: "/auth" });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (isPopout) {
      document.title = "Team Chat — LeadVault";
    }
  }, [isPopout]);

  if (loading || !user) {
    if (isPopout) {
      return (
        <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
          Loading Chat Vault…
        </div>
      );
    }
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
          Loading Chat Vault…
        </div>
      </AppShell>
    );
  }

  if (isPopout) {
    return (
      <div className="flex h-screen w-full overflow-hidden bg-background">
        {(!isMobile || !selectedId) && (
          <div className="h-full w-full md:w-auto">
            <ChatSidebar
              isPopout
              selectedConversationId={selectedId}
              onSelectConversation={(id) => setSelectedId(id)}
            />
          </div>
        )}
        {(!isMobile || !!selectedId) && (
          <div className="min-w-0 flex-1 overflow-hidden">
            <ChatWorkspace
              hideSidebar
              isPopout
              selectedConversationId={selectedId}
              onSelectConversation={(id) => setSelectedId(id)}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <AppShell fullBleed>
      <div className="flex h-[calc(100vh-3rem)] md:h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-background">
        {(!isMobile || !selectedId) && (
          <div className="h-full w-full md:w-auto">
            <ChatSidebar
              selectedConversationId={selectedId}
              onSelectConversation={(id) => setSelectedId(id)}
            />
          </div>
        )}
        {(!isMobile || !!selectedId) && (
          <div className="min-w-0 flex-1 overflow-hidden">
            <ChatWorkspace
              hideSidebar
              selectedConversationId={selectedId}
              onSelectConversation={(id) => setSelectedId(id)}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}