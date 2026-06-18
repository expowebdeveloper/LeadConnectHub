import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow, format } from "date-fns";
import { Pencil, Send, X, Check } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MentionAutocomplete, type MentionPick } from "@/components/chat/MentionAutocomplete";
import {
  addLeadNote,
  editLeadNote,
  listLeadNotes,
  type LeadNote,
} from "@/lib/lead-notes.functions";

const EDIT_WINDOW_MS = 15 * 60 * 1000;

const MENTION_RE = /(@[\w.\-]+(?:\s[\w.\-]+){0,2})/g;
function renderWithMentions(body: string) {
  const parts = body.split(MENTION_RE);
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span
        key={i}
        className="rounded bg-primary/15 px-1 font-medium text-primary"
      >
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

type Props = {
  leadId: string;
  leadTable: "leads" | "list_leads";
  /** auto | home | <extra_line_id>. Omit / null for the main thread. */
  lineKey?: string | null;
  /** Heading text shown above the thread. */
  title?: string;
  readOnly?: boolean;
  /** Optional class applied to the outer wrapper. */
  className?: string;
};

export function LeadNotesThread({
  leadId,
  leadTable,
  lineKey = null,
  title = "Notes",
  readOnly = false,
  className,
}: Props) {
  const { user, profile } = useAuth();
  const uid = user?.id ?? null;
  const qc = useQueryClient();
  const listFn = useServerFn(listLeadNotes);
  const addFn = useServerFn(addLeadNote);
  const editFn = useServerFn(editLeadNote);

  const queryKey = ["lead_notes", leadTable, leadId, lineKey ?? "__main__"] as const;

  const { data: notes = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { leadTable, leadId, lineKey } }),
    staleTime: 15_000,
  });

  // Realtime: refetch when a note for this thread changes.
  useEffect(() => {
    const channel = supabase
      .channel(`lead_notes:${leadTable}:${leadId}:${lineKey ?? "main"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lead_notes", filter: `lead_id=eq.${leadId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { line_key: string | null } | undefined;
          if (!row) return;
          if ((row.line_key ?? null) !== (lineKey ?? null)) return;
          qc.invalidateQueries({ queryKey });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [leadId, leadTable, lineKey, qc]);

  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const mentionStartRef = useRef<number | null>(null);

  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(value);
    const caret = e.target.selectionStart ?? value.length;
    // Find an @ token immediately before caret with no whitespace between.
    const upto = value.slice(0, caret);
    const m = upto.match(/(?:^|\s)@([\w.\-]*)$/);
    if (m) {
      mentionStartRef.current = caret - m[1].length - 1; // position of '@'
      setMentionQuery(m[1]);
    } else {
      mentionStartRef.current = null;
      setMentionQuery(null);
    }
  };

  const insertMention = (pick: MentionPick) => {
    const ta = composerRef.current;
    const start = mentionStartRef.current;
    if (start == null) return;
    const caret = ta?.selectionStart ?? draft.length;
    const before = draft.slice(0, start);
    const after = draft.slice(caret);
    const label = pick.id === "__everyone__" ? "everyone" : pick.name;
    const inserted = `@${label} `;
    const next = before + inserted + after;
    setDraft(next);
    setMentionQuery(null);
    mentionStartRef.current = null;
    // restore focus + caret after the inserted mention
    requestAnimationFrame(() => {
      const el = composerRef.current;
      if (!el) return;
      el.focus();
      const pos = before.length + inserted.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const addM = useMutation({
    mutationFn: (body: string) => addFn({ data: { leadTable, leadId, lineKey, body } }),
    onSuccess: (note) => {
      setDraft("");
      qc.setQueryData<LeadNote[]>(queryKey, (prev) =>
        prev ? [...prev, note] : [note],
      );
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Couldn't post note"),
  });

  const editM = useMutation({
    mutationFn: (v: { id: string; body: string }) => editFn({ data: v }),
    onSuccess: (note) => {
      qc.setQueryData<LeadNote[]>(queryKey, (prev) =>
        prev ? prev.map((n) => (n.id === note.id ? note : n)) : [note],
      );
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Couldn't edit note"),
  });

  const handleSubmit = () => {
    const v = draft.trim();
    if (!v) return;
    addM.mutate(v);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className={cn("rounded-lg border bg-card/40", className)}>
      <div className="max-h-72 space-y-3 overflow-y-auto px-3 py-3">
        {isLoading && (
          <div className="text-xs text-muted-foreground">Loading…</div>
        )}
        {notes.map((n) => (
          <NoteRow
            key={n.id}
            note={n}
            isMine={n.author_id === uid}
            onSaveEdit={(body) => editM.mutate({ id: n.id, body })}
            editing={editM.isPending}
          />
        ))}
      </div>

      {!readOnly && (
        <div className="border-t border-border/60 px-3 py-2">
          <div className="flex items-start gap-2">
            <AgentAvatar
              name={
                profile?.full_name ??
                (user?.user_metadata?.full_name as string | undefined) ??
                user?.email ??
                "Me"
              }
              path={
                profile?.avatar_url ??
                (user?.user_metadata?.avatar_url as string | undefined) ??
                null
              }
              size="sm"
            />
            <div className="flex-1">
              <div className="relative">
              <Textarea
                ref={composerRef}
                rows={2}
                placeholder="Write a note… (use @ to tag a teammate · ⌘/Ctrl + Enter to post)"
                value={draft}
                onChange={handleDraftChange}
                onKeyDown={onKeyDown}
                className="rounded-lg bg-background/60 text-sm"
                disabled={addM.isPending}
              />
              {mentionQuery !== null && (
                <MentionAutocomplete
                  query={mentionQuery}
                  onPick={insertMention}
                  onDismiss={() => {
                    setMentionQuery(null);
                    mentionStartRef.current = null;
                  }}
                />
              )}
              </div>
              <div className="mt-1 flex items-center justify-end">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSubmit}
                  disabled={!draft.trim() || addM.isPending}
                  className="h-7 gap-1"
                >
                  <Send className="h-3 w-3" />
                  {addM.isPending ? "Posting…" : "Post"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NoteRow({
  note,
  isMine,
  onSaveEdit,
  editing,
}: {
  note: LeadNote;
  isMine: boolean;
  onSaveEdit: (body: string) => void;
  editing: boolean;
}) {
  const created = useMemo(() => new Date(note.created_at), [note.created_at]);
  const withinEditWindow = isMine && Date.now() - created.getTime() < EDIT_WINDOW_MS;

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  useEffect(() => setDraft(note.body), [note.body]);

  const authorName =
    note.author?.full_name?.trim() || note.author?.email || "Teammate";

  return (
    <div className="flex items-start gap-2">
      <AgentAvatar name={authorName} path={note.author?.avatar_url ?? null} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl bg-muted/60 px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <div className="truncate text-xs font-semibold text-foreground">
              {authorName}
            </div>
            {withinEditWindow && !isEditing && (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="text-[10px] text-muted-foreground/70 hover:text-foreground"
                title="Edit (within 15 min)"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </div>
          {isEditing ? (
            <div className="mt-1">
              <Textarea
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="rounded-lg bg-background/80 text-sm"
                autoFocus
              />
              <div className="mt-1 flex justify-end gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2"
                  onClick={() => {
                    setDraft(note.body);
                    setIsEditing(false);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-6 gap-1 px-2"
                  disabled={editing || !draft.trim() || draft.trim() === note.body}
                  onClick={() => {
                    onSaveEdit(draft.trim());
                    setIsEditing(false);
                  }}
                >
                  <Check className="h-3 w-3" /> Save
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">
              {renderWithMentions(note.body)}
            </div>
          )}
        </div>
        <div className="mt-0.5 px-2 text-[10px] text-muted-foreground">
          <span title={format(created, "PPpp")}>
            {formatDistanceToNow(created, { addSuffix: true })}
          </span>
          {note.edited_at && (
            <span title={format(new Date(note.edited_at), "PPpp")}> · edited</span>
          )}
        </div>
      </div>
    </div>
  );
}