import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChatWorkspace } from "./ChatWorkspace";
import { Minus, Maximize2, X } from "lucide-react";
import { chatBubbles } from "@/hooks/useChatBubbles";

export function ChatBubbleWindow({ conversationId }: { conversationId: string }) {
  const navigate = useNavigate();
  const onChatRoute = useRouterState({
    select: (s) => s.location.pathname.startsWith("/team-chat"),
  });

  if (onChatRoute) return null;

  return (
    <div className="pointer-events-auto fixed bottom-3 right-12 sm:bottom-4 sm:right-14 z-50 flex h-[460px] w-[340px] max-w-[calc(100vw-4rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl sm:h-[480px] sm:w-[360px]">
      <div className="absolute right-2 top-1.5 z-10 flex items-center gap-0.5 rounded-md bg-card px-0.5 backdrop-blur">
        <button
          type="button"
          onClick={() => {
            chatBubbles.setActive(null);
            navigate({ to: "/team-chat", search: { c: conversationId } });
          }}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Open full chat"
          title="Open full chat"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => chatBubbles.setActive(null)}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Minimize"
          title="Minimize"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => chatBubbles.closeBubble(conversationId)}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Close"
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <ChatWorkspace
          compact
          hideSidebar
          initialConversationId={conversationId}
          selectedConversationId={conversationId}
        />
      </div>
    </div>
  );
}