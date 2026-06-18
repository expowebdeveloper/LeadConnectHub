ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lead_source text NOT NULL DEFAULT 'internet'
    CHECK (lead_source IN ('internet','referral','cold_call','live_transfer','aged','other')),
  ADD COLUMN IF NOT EXISTS referred_by text;

ALTER TABLE public.list_leads
  ADD COLUMN IF NOT EXISTS lead_source text NOT NULL DEFAULT 'internet'
    CHECK (lead_source IN ('internet','referral','cold_call','live_transfer','aged','other')),
  ADD COLUMN IF NOT EXISTS referred_by text;