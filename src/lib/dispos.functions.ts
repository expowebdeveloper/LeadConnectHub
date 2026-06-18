import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type DispoOption = {
  value: string;
  label: string;
  sort_order: number;
  enabled: boolean;
  is_system: boolean;
};

export const listDispoOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("dispo_options")
      .select("value, label, sort_order, enabled, is_system")
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as DispoOption[];
  });

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (!(data ?? []).some((r) => r.role === "admin")) {
    throw new Error("Forbidden — admin only");
  }
}

export const updateDispoOption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      value: string;
      label?: string;
      sort_order?: number;
      enabled?: boolean;
    }) => input,
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const patch: {
      label?: string;
      sort_order?: number;
      enabled?: boolean;
    } = {};
    if (data.label !== undefined) patch.label = data.label.trim();
    if (data.sort_order !== undefined) patch.sort_order = data.sort_order;
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin
      .from("dispo_options")
      .update(patch)
      .eq("value", data.value);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addDispoOption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { value: string; label: string; sort_order?: number }) => input,
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { data: row, error } = await supabaseAdmin.rpc("add_dispo_option", {
      p_value: data.value,
      p_label: data.label,
      p_sort: data.sort_order ?? 100,
    });
    if (error) throw new Error(error.message);
    return row as DispoOption;
  });

export const deleteDispoOption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { value: string }) => input)
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    // We never DROP the enum value (historical rows may still reference it).
    // Custom (non-system) options get removed from the table; system ones
    // are just disabled so they disappear from dropdowns.
    const { data: row } = await supabaseAdmin
      .from("dispo_options")
      .select("is_system")
      .eq("value", data.value)
      .maybeSingle();
    if (row?.is_system) {
      const { error } = await supabaseAdmin
        .from("dispo_options")
        .update({ enabled: false })
        .eq("value", data.value);
      if (error) throw new Error(error.message);
      return { ok: true, mode: "disabled" as const };
    }
    const { error } = await supabaseAdmin
      .from("dispo_options")
      .delete()
      .eq("value", data.value);
    if (error) throw new Error(error.message);
    return { ok: true, mode: "deleted" as const };
  });