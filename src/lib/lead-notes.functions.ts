import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LeadTable = z.enum(["leads", "list_leads"]);

export type LeadNoteAuthor = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export type LeadNote = {
  id: string;
  lead_table: "leads" | "list_leads";
  lead_id: string;
  line_key: string | null;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  author: LeadNoteAuthor | null;
};

export const listLeadNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        leadTable: LeadTable,
        leadId: z.string().uuid(),
        lineKey: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<LeadNote[]> => {
    const { supabase } = context;
    let q = supabase
      .from("lead_notes")
      .select("id, lead_table, lead_id, line_key, author_id, body, created_at, edited_at")
      .eq("lead_table", data.leadTable)
      .eq("lead_id", data.leadId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (data.lineKey == null) q = q.is("line_key", null);
    else q = q.eq("line_key", data.lineKey);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const notes = (rows ?? []) as Omit<LeadNote, "author">[];
    if (notes.length === 0) return [];

    const ids = Array.from(new Set(notes.map((n) => n.author_id)));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", ids);
    const byId = new Map<string, LeadNoteAuthor>();
    for (const p of profiles ?? []) byId.set(p.id, p as LeadNoteAuthor);
    return notes.map((n) => ({ ...n, author: byId.get(n.author_id) ?? null }));
  });

export const addLeadNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        leadTable: LeadTable,
        leadId: z.string().uuid(),
        lineKey: z.string().nullable().optional(),
        body: z.string().trim().min(1).max(4000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<LeadNote> => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("lead_notes")
      .insert({
        lead_table: data.leadTable,
        lead_id: data.leadId,
        line_key: data.lineKey ?? null,
        author_id: userId,
        body: data.body.trim(),
      })
      .select("id, lead_table, lead_id, line_key, author_id, body, created_at, edited_at")
      .single();
    if (error) throw new Error(error.message);

    // Log activity entry so the existing timeline shows it too.
    await supabase.from("lead_activities").insert({
      lead_table: data.leadTable,
      lead_id: data.leadId,
      user_id: userId,
      action: "note_added",
      details: { note_id: row.id, line_key: data.lineKey ?? null },
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .eq("id", userId)
      .maybeSingle();
    return { ...(row as Omit<LeadNote, "author">), author: (profile as LeadNoteAuthor) ?? null };
  });

export const editLeadNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        body: z.string().trim().min(1).max(4000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<LeadNote> => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("lead_notes")
      .update({ body: data.body.trim(), edited_at: new Date().toISOString() })
      .eq("id", data.id)
      .select("id, lead_table, lead_id, line_key, author_id, body, created_at, edited_at")
      .single();
    if (error) throw new Error(error.message);

    await supabase.from("lead_activities").insert({
      lead_table: row.lead_table,
      lead_id: row.lead_id,
      user_id: userId,
      action: "note_edited",
      details: { note_id: row.id, line_key: row.line_key },
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .eq("id", row.author_id)
      .maybeSingle();
    return { ...(row as Omit<LeadNote, "author">), author: (profile as LeadNoteAuthor) ?? null };
  });