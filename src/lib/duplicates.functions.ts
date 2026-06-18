import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function normalizePhone(input: string): string {
  const digits = (input || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function phoneVariants(phone: string): string[] {
  const n = normalizePhone(phone);
  if (n.length !== 10) return [];
  const formatted = `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  return Array.from(new Set([n, formatted, `1${n}`, `+1${n}`, `${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}`]));
}

export type DuplicateMatch = {
  id: string;
  source: "leads" | "list_leads";
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  vendor_id: string | null;
  dispo: string | null;
  created_at: string;
};

export const findDuplicatePhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ phone: z.string().min(7).max(20) }).parse)
  .handler(async ({ data }): Promise<{ matches: DuplicateMatch[] }> => {
    const variants = phoneVariants(data.phone);
    if (variants.length === 0) return { matches: [] };
    const inList = `(${variants.map((v) => `"${v}"`).join(",")})`;

    const [leadsRes, listRes] = await Promise.all([
      supabaseAdmin
        .from("leads")
        .select("id, first_name, last_name, phone, vendor_id, dispo, created_at")
        .filter("phone", "in", inList)
        .order("created_at", { ascending: false })
        .limit(10),
      supabaseAdmin
        .from("list_leads")
        .select("id, first_name, last_name, phone, vendor_id, dispo, created_at")
        .filter("phone", "in", inList)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const matches: DuplicateMatch[] = [];
    for (const r of leadsRes.data ?? []) matches.push({ ...(r as any), source: "leads" });
    for (const r of listRes.data ?? []) matches.push({ ...(r as any), source: "list_leads" });
    return { matches };
  });