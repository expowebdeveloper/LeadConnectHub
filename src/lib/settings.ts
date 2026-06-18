import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_COMMISSION_CONFIG, type CommissionConfig } from "./commissions";
import { SCRIPT_TYPES, type ScriptType } from "./constants";

export type CallOutcome = { value: string; label: string; color?: string };

export type FeatureFlags = {
  enable_litigator_check: boolean;
  enable_jornaya_upload: boolean;
  enable_manual_import: boolean;
  enable_call_logging: boolean;
  enable_email_sending: boolean;
  enable_follow_ups: boolean;
  enable_analytics: boolean;
  enable_list_leads: boolean;
  require_quoted_premium_on_sale: boolean;
  allow_vendor_self_signup: boolean;
  allow_lead_release: boolean;
};

export type LeadDefaults = {
  default_vendor_payout: number;
  auto_archive_days: number;
  claim_lock_minutes: number;
  max_active_claims_per_agent: number;
};

export type Branding = {
  company_name: string;
  logo_url: string;
  primary_color: string;
  support_email: string;
  tagline: string;
};

export type LeadScripts = Record<ScriptType, string>;

export type AppSettings = {
  features: FeatureFlags;
  lead_defaults: LeadDefaults;
  call_outcomes: { outcomes: CallOutcome[] };
  branding: Branding;
  commissions: CommissionConfig;
  scripts: LeadScripts;
};

export const DEFAULT_SETTINGS: AppSettings = {
  features: {
    enable_litigator_check: true,
    enable_jornaya_upload: true,
    enable_manual_import: true,
    enable_call_logging: true,
    enable_email_sending: true,
    enable_follow_ups: true,
    enable_analytics: true,
    enable_list_leads: true,
    require_quoted_premium_on_sale: false,
    allow_vendor_self_signup: true,
    allow_lead_release: true,
  },
  lead_defaults: {
    default_vendor_payout: 25,
    auto_archive_days: 1,
    claim_lock_minutes: 60,
    max_active_claims_per_agent: 25,
  },
  call_outcomes: {
    outcomes: [
      { value: "connected_sale", label: "Connected — Sale", color: "green" },
      { value: "connected_follow_up", label: "Connected — Follow Up", color: "blue" },
      { value: "connected_not_interested", label: "Connected — Not Interested", color: "yellow" },
      { value: "no_answer", label: "No Answer", color: "gray" },
      { value: "voicemail", label: "Left Voicemail", color: "gray" },
      { value: "bad_number", label: "Bad Number", color: "red" },
      { value: "do_not_call", label: "Do Not Call Request", color: "red" },
    ],
  },
  branding: {
    company_name: "LeadVault",
    logo_url: "",
    primary_color: "",
    support_email: "",
    tagline: "",
  },
  commissions: DEFAULT_COMMISSION_CONFIG,
  scripts: Object.fromEntries(SCRIPT_TYPES.map((t) => [t.value, ""])) as LeadScripts,
};

export function useSettings() {
  return useQuery({
    queryKey: ["app_settings"],
    queryFn: async (): Promise<AppSettings> => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("key, value")
        .is("workspace_id", null);
      if (error) throw error;
      const merged = { ...DEFAULT_SETTINGS } as AppSettings;
      for (const row of data ?? []) {
        const k = row.key as keyof AppSettings;
        if (k in merged) {
          // shallow-merge so newly added defaults still apply
          (merged as Record<string, unknown>)[k] = {
            ...(merged[k] as object),
            ...(row.value as object),
          };
        }
      }
      return merged;
    },
    staleTime: 60_000,
  });
}

export function useUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { key: keyof AppSettings; value: unknown }) => {
      const value = args.value as never;
      const { data: existing, error: selErr } = await supabase
        .from("app_settings")
        .select("id")
        .is("workspace_id", null)
        .eq("key", args.key)
        .maybeSingle();
      if (selErr) throw selErr;
      if (existing) {
        const { error } = await supabase
          .from("app_settings")
          .update({ value })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("app_settings")
          .insert({ workspace_id: null, key: args.key, value });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app_settings"] }),
  });
}