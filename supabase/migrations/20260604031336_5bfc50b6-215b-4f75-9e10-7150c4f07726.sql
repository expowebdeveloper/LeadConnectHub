
-- Per-tenant app settings (workspace_id NULL = global default; future-ready for multi-tenant)
CREATE TABLE public.app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NULL,
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX app_settings_workspace_key_idx
  ON public.app_settings (COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read settings (so feature toggles can drive UI for non-admins)
CREATE POLICY "Authenticated can read settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can write
CREATE POLICY "Admins can insert settings"
  ON public.app_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update settings"
  ON public.app_settings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete settings"
  ON public.app_settings FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER app_settings_touch_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed default global settings
INSERT INTO public.app_settings (workspace_id, key, value) VALUES
  (NULL, 'features', '{
    "enable_dnc_check": true,
    "enable_jornaya_upload": true,
    "enable_manual_import": true,
    "enable_call_logging": true,
    "enable_email_sending": true,
    "enable_follow_ups": true,
    "enable_analytics": true,
    "enable_list_leads": true,
    "require_quoted_premium_on_sale": false,
    "allow_vendor_self_signup": true,
    "allow_lead_release": true
  }'::jsonb),
  (NULL, 'lead_defaults', '{
    "default_vendor_payout": 25,
    "auto_archive_days": 1,
    "claim_lock_minutes": 60,
    "max_active_claims_per_agent": 25
  }'::jsonb),
  (NULL, 'call_outcomes', '{
    "outcomes": [
      {"value": "connected_sale", "label": "Connected — Sale", "color": "green"},
      {"value": "connected_follow_up", "label": "Connected — Follow Up", "color": "blue"},
      {"value": "connected_not_interested", "label": "Connected — Not Interested", "color": "yellow"},
      {"value": "no_answer", "label": "No Answer", "color": "gray"},
      {"value": "voicemail", "label": "Left Voicemail", "color": "gray"},
      {"value": "bad_number", "label": "Bad Number", "color": "red"},
      {"value": "do_not_call", "label": "Do Not Call Request", "color": "red"}
    ]
  }'::jsonb),
  (NULL, 'branding', '{
    "company_name": "LeadVault",
    "logo_url": "",
    "primary_color": "",
    "support_email": "",
    "tagline": ""
  }'::jsonb);
