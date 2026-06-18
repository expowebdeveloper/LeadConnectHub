ALTER TABLE public.list_leads
ADD COLUMN IF NOT EXISTS list_type_priority integer
GENERATED ALWAYS AS (
  CASE list_type
    WHEN 'winback' THEN 1
    WHEN 'requote' THEN 2
    WHEN 'ivantage_no_allstate' THEN 3
    WHEN 'aged' THEN 4
    ELSE 99
  END
) STORED;

CREATE INDEX IF NOT EXISTS list_leads_priority_idx
  ON public.list_leads (list_type_priority, created_at DESC);