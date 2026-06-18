ALTER TABLE public.list_leads ADD COLUMN IF NOT EXISTS shark_tank_side text;
ALTER TABLE public.list_leads DROP CONSTRAINT IF EXISTS list_leads_shark_tank_side_check;
ALTER TABLE public.list_leads ADD CONSTRAINT list_leads_shark_tank_side_check CHECK (shark_tank_side IS NULL OR shark_tank_side IN ('auto','home'));
CREATE INDEX IF NOT EXISTS idx_list_leads_shark_tank_side ON public.list_leads (shark_tank_side);