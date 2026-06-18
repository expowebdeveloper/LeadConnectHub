import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type LeadDispute = {
  id: string;
  lead_id: string;
  lead_source: "live" | "list";
  vendor_id: string;
  submitted_by: string;
  reason_category: string;
  reason_details: string | null;
  evidence_paths: string[];
  status: "open" | "approved" | "rejected";
  admin_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

async function resolveActingUser(
  callerId: string,
  asUserId?: string | null,
): Promise<string> {
  if (!asUserId || asUserId === callerId) return callerId;
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId);
  if ((roles ?? []).some((r) => r.role === "admin")) return asUserId;
  return callerId;
}

async function resolveVendorIdForUser(userId: string): Promise<string> {
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("id, parent_vendor_id")
    .eq("id", userId)
    .maybeSingle();
  if (!prof) throw new Error("Profile not found");
  return prof.parent_vendor_id ?? prof.id;
}

const CreateInput = z.object({
  leadId: z.string().uuid(),
  source: z.enum(["live", "list"]),
  reasonCategory: z.string().min(1).max(80),
  reasonDetails: z.string().max(2000).optional().nullable(),
  evidencePaths: z.array(z.string().min(1).max(500)).max(10).default([]),
  asUserId: z.string().uuid().optional().nullable(),
});

export const createDispute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ context, data }) => {
    const actingUser = await resolveActingUser(context.userId, data.asUserId);
    const vendorId = await resolveVendorIdForUser(actingUser);

    // Verify the lead belongs to this vendor.
    const table = data.source === "live" ? "leads" : "list_leads";
    const { data: lead, error: leadErr } = await supabaseAdmin
      .from(table)
      .select("id, vendor_id")
      .eq("id", data.leadId)
      .maybeSingle();
    if (leadErr) throw new Error(leadErr.message);
    if (!lead || lead.vendor_id !== vendorId) throw new Error("Lead not found");

    // Prevent duplicate open disputes.
    const { data: existing } = await supabaseAdmin
      .from("lead_disputes")
      .select("id")
      .eq("lead_id", data.leadId)
      .eq("lead_source", data.source)
      .eq("status", "open")
      .maybeSingle();
    if (existing) throw new Error("A dispute is already open for this lead");

    const { data: inserted, error } = await supabaseAdmin
      .from("lead_disputes")
      .insert({
        lead_id: data.leadId,
        lead_source: data.source,
        vendor_id: vendorId,
        submitted_by: actingUser,
        reason_category: data.reasonCategory,
        reason_details: data.reasonDetails ?? null,
        evidence_paths: data.evidencePaths ?? [],
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return inserted as LeadDispute;
  });

const ListInput = z.object({
  asUserId: z.string().uuid().optional().nullable(),
});

export const listMyDisputes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input ?? {}))
  .handler(async ({ context, data }) => {
    const actingUser = await resolveActingUser(context.userId, data.asUserId);
    const vendorId = await resolveVendorIdForUser(actingUser);
    const { data: rows, error } = await supabaseAdmin
      .from("lead_disputes")
      .select("*")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []) as LeadDispute[];
  });