import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { ToolResultCard } from "./AIAnswerCard";
import { Sparkles, Brain, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const QUICK_PROMPTS = [
  { label: "Today's summary", prompt: "Give me today's KPI snapshot and a 3-bullet summary of what stands out." },
  { label: "Forecast month", prompt: "Project this month's auto sales using business-day pace. Compare to our monthly goal." },
  { label: "Agent coaching", prompt: "Compare agent performance this week. Identify who needs coaching and why." },
  { label: "Vendor quality", prompt: "Rank vendors by close rate and cost-per-sale this month. Recommend budget shifts." },
  { label: "Untouched leads", prompt: "Show leads created more than 30 minutes ago that are still untouched." },
  { label: "Lead priorities", prompt: "What are the top leads we should be working right now?" },
];

type Props = {
  conversationId: string | null;
  context?: { kind?: string; id?: string | null };
  onConversationCreated?: (id: string) => void;
  initialMessages?: UIMessage[];
};

export function AIChatPanel({ conversationId, context, onConversationCreated, initialMessages }: Props) {
  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/ai/chat",
    body: { conversationId, context },
    fetch: async (input, init) => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const headers = new Headers(init?.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    },
  }), [conversationId, context]);

  const chatId = conversationId ?? "new";
  const { messages, sendMessage, status, error, regenerate } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
    onError: (e) => toast.error(e.message || "AI request failed"),
    onFinish: () => {
      // Server returns X-AI-Conversation-Id; we don't have direct access here.
      // The parent re-fetches list on demand.
    },
  });

  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { textareaRef.current?.focus(); }, [conversationId]);

  async function submit(text: string) {
    if (!text.trim()) return;
    setInput("");
    await sendMessage({ text });
    if (!conversationId && onConversationCreated) {
      // Trigger a refresh of conversation list shortly after first response.
      setTimeout(() => onConversationCreated("__new__"), 300);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Quick prompts */}
      <div className="border-b border-border/60 px-4 py-2">
        <div className="flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map((q) => (
            <Button
              key={q.label}
              size="sm"
              variant="outline"
              className="h-7 rounded-full border-primary/30 px-3 text-xs hover:border-primary hover:bg-primary/10"
              onClick={() => submit(q.prompt)}
              disabled={status === "submitted" || status === "streaming"}
            >
              {q.label}
            </Button>
          ))}
        </div>
      </div>

      <Conversation className="flex-1">
        <ConversationContent className="max-w-3xl">
          {messages.length === 0 && (
            <ConversationEmptyState
              icon={<Brain className="size-10 text-primary" />}
              title="Ask LeadVault AI"
              description={'Try: "How many sales today?" · "Which vendors are underperforming?" · "Forecast this month\u2019s premium."'}
            />
          )}

          {messages.map((m) => (
            <Message key={m.id} from={m.role}>
              <MessageContent>
                {m.parts.map((part: any, i: number) => {
                  if (part.type === "text") {
                    return <MessageResponse key={i}>{part.text}</MessageResponse>;
                  }
                  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
                    const toolName = part.type.slice(5);
                    return (
                      <Tool key={i} defaultOpen={false}>
                        <ToolHeader type={toolName as any} state={part.state} />
                        <ToolContent>
                          {part.input && <ToolInput input={part.input} />}
                          <ToolOutput output={part.output ? <ToolResultCard name={toolName} output={part.output} /> : null} errorText={part.errorText} />
                        </ToolContent>
                      </Tool>
                    );
                  }
                  return null;
                })}
              </MessageContent>
            </Message>
          ))}

          {status === "submitted" && (
            <div className="px-2">
              <Shimmer>Thinking…</Shimmer>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              {error.message}
              <Button size="sm" variant="ghost" className="ml-auto h-6" onClick={() => regenerate()}>Retry</Button>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-border/60 p-3">
        <PromptInput
          onSubmit={(_msg, e) => { e.preventDefault(); submit(input); }}
        >
          <PromptInputTextarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about leads, agents, vendors, sales, forecasts…"
          />
          <PromptInputFooter className="justify-between">
            <div className="text-[10px] text-muted-foreground">
              <Sparkles className="mr-1 inline h-3 w-3 text-primary" />
              Grounded in real CRM data · admin only
            </div>
            <PromptInputSubmit status={status} disabled={!input.trim()} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}