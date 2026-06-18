ALTER TABLE public.list_leads DROP CONSTRAINT IF EXISTS list_leads_list_type_check;
ALTER TABLE public.list_leads ADD CONSTRAINT list_leads_list_type_check CHECK (list_type IN ('winback','requote','ivantage_no_allstate','aged','anchorline','missed_transfer'));

ALTER TABLE public.list_leads DROP COLUMN IF EXISTS list_type_priority;
ALTER TABLE public.list_leads ADD COLUMN list_type_priority integer GENERATED ALWAYS AS (
  CASE list_type
    WHEN 'winback' THEN 1
    WHEN 'requote' THEN 2
    WHEN 'ivantage_no_allstate' THEN 3
    WHEN 'aged' THEN 4
    WHEN 'anchorline' THEN 5
    ELSE 99
  END
) STORED;

CREATE INDEX IF NOT EXISTS list_leads_priority_idx ON public.list_leads (list_type_priority, created_at DESC);