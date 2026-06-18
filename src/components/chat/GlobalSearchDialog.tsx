import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { globalChatSearch } from "@/lib/chat-crm.functions";
import { createDM } from "@/lib/chat.functions";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Users, Hash, MessageSquare, FileText, Target } from "lucide-react";
import { toast } from "sonner";

type Results = Awaited<ReturnType<ReturnType<typeof useServerFn<typeof globalChatSearch>>>>;

export function GlobalSearchDialog({
  open,
  onClose,
  onSelectConversation,
}: {
  open: boolean;
  onClose: () => void;
  onSelectConversation: (conversationId: string) => void;
}) {
  const search = useServerFn(globalChatSearch);
  const newDM = useServerFn(createDM);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setQ("");
      setResults(null);
    }
  }, [open]);

  useEffect(() => {
    if (!q.trim()) {
      setResults(null);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      void search({ data: { q: q.trim() } })
        .then(setResults)
        .catch(() => setResults(null))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [q, search]);

  return (
    <CommandDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <CommandInput value={q} onValueChange={setQ} placeholder="Search messages, people, files, or leads…" />
      <CommandList>
        {loading && <div className="p-3 text-xs text-muted-foreground">Searching…</div>}
        {!loading && q.trim() && results &&
          results.people.length === 0 && results.conversations.length === 0 &&
          results.messages.length === 0 && results.files.length === 0 && results.leads.length === 0 && (
          <CommandEmpty>No matches.</CommandEmpty>
        )}
        {results && results.people.length > 0 && (
          <CommandGroup heading="People">
            {results.people.map((p) => (
              <CommandItem
                key={p.id}
                onSelect={async () => {
                  try {
                    const r = await newDM({ data: { otherUserId: p.id } });
                    onSelectConversation(r.id);
                    onClose();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  }
                }}
              >
                <Users className="mr-2 h-3.5 w-3.5 text-chat-accent" />
                {p.name}
                <span className="ml-2 text-[11px] text-muted-foreground">{p.email}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results && results.conversations.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Conversations">
              {results.conversations.map((c) => (
                <CommandItem
                  key={c.id}
                  onSelect={() => { onSelectConversation(c.id); onClose(); }}
                >
                  <Hash className="mr-2 h-3.5 w-3.5 text-chat-accent" />
                  {c.name ?? "Conversation"}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {results && results.messages.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Messages">
              {results.messages.map((m) => (
                <CommandItem
                  key={m.id}
                  onSelect={() => { onSelectConversation(m.conversation_id); onClose(); }}
                >
                  <MessageSquare className="mr-2 h-3.5 w-3.5 text-chat-accent" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{m.body}</span>
                    <span className="text-[10px] text-muted-foreground">in {m.conversation_name}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {results && results.files.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Files">
              {results.files.map((f) => (
                <CommandItem
                  key={f.id}
                  onSelect={() => { if (f.conversation_id) { onSelectConversation(f.conversation_id); onClose(); } }}
                >
                  <FileText className="mr-2 h-3.5 w-3.5 text-chat-accent" />
                  {f.file_name}
                  <span className="ml-2 text-[11px] text-muted-foreground">{f.conversation_name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {results && results.leads.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Leads">
              {results.leads.map((l) => (
                <CommandItem
                  key={l.id}
                  onSelect={() => { void navigate({ to: "/leads/$leadId", params: { leadId: l.id } }); onClose(); }}
                >
                  <Target className="mr-2 h-3.5 w-3.5 text-chat-accent" />
                  {l.name}
                  <span className="ml-2 text-[11px] text-muted-foreground">{l.phone ?? l.email ?? ""}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}