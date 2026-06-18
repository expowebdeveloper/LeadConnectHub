import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getAiConversation } from "@/lib/ai-context.functions";
import { AIConversationList } from "./AIConversationList";
import { AIChatPanel } from "./AIChatPanel";
import { AIInsightsPanel } from "./AIInsightsPanel";
import { Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Settings as SettingsIcon } from "lucide-react";

export function AIWorkspace({ initialContext }: { initialContext?: { kind?: string; id?: string | null } }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [askKey, setAskKey] = useState(0);
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);

  const getConv = useServerFn(getAiConversation);
  const conv = useQuery({
    queryKey: ["ai_conv", activeId],
    queryFn: () => activeId ? getConv({ data: { id: activeId } }) : Promise.resolve(null),
    enabled: !!activeId,
  });

  // Force re-mount chat panel when user requests a fresh question or switches threads.
  const chatKey = activeId ?? `new-${askKey}`;
  const initialMessages = activeId
    ? (conv.data?.messages ?? []).map((m: any) => ({
        id: m.id,
        role: m.role,
        parts: m.parts ?? [],
      }))
    : pendingAsk
      ? [{ id: `seed-${askKey}`, role: "user" as const, parts: [{ type: "text" as const, text: pendingAsk }] }]
      : undefined;

  return (
    <div className="grid h-[calc(100vh-64px)] grid-cols-1 md:grid-cols-[260px_1fr_280px]">
      {/* Left: history */}
      <aside className="hidden border-r border-border/60 bg-card/40 md:flex md:flex-col">
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            LeadVault AI
          </div>
          <Link to="/ai/settings">
            <Button size="icon-sm" variant="ghost" aria-label="Settings">
              <SettingsIcon className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
        <AIConversationList
          activeId={activeId}
          onSelect={(id) => { setActiveId(id); setPendingAsk(null); if (!id) setAskKey((k) => k + 1); }}
        />
      </aside>

      {/* Center: chat */}
      <section className="flex flex-col overflow-hidden border-r border-border/60">
        <AIChatPanel
          key={chatKey}
          conversationId={activeId}
          context={initialContext}
          initialMessages={initialMessages as never}
        />
      </section>

      {/* Right: insights */}
      <aside className="hidden border-l border-border/60 bg-card/40 lg:block">
        <AIInsightsPanel
          onAsk={(q) => { setActiveId(null); setPendingAsk(q); setAskKey((k) => k + 1); }}
        />
      </aside>
    </div>
  );
}