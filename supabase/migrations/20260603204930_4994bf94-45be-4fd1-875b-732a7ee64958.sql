-- Follow-up scheduling
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMPTZ;
ALTER TABLE public.list_leads ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_leads_follow_up_at ON public.leads(follow_up_at) WHERE follow_up_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_list_leads_follow_up_at ON public.list_leads(follow_up_at) WHERE follow_up_at IS NOT NULL;

-- Activity audit trail
CREATE TABLE IF NOT EXISTS public.lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL,
  lead_table TEXT NOT NULL CHECK (lead_table IN ('leads','list_leads')),
  user_id UUID,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON public.lead_activities(lead_table, lead_id, created_at DESC);

GRANT SELECT ON public.lead_activities TO authenticated;
GRANT ALL ON public.lead_activities TO service_role;

ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sales and admins view activities" ON public.lead_activities;
CREATE POLICY "Sales and admins view activities" ON public.lead_activities
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'sales'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role));

-- Trigger function: log material changes on leads/list_leads
CREATE OR REPLACE FUNCTION public.log_lead_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  tbl text := TG_TABLE_NAME;
BEGIN
  IF NEW.claimed_by IS DISTINCT FROM OLD.claimed_by THEN
    IF NEW.claimed_by IS NOT NULL AND OLD.claimed_by IS NULL THEN
      INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
      VALUES (NEW.id, tbl, uid, 'claimed', jsonb_build_object('claimed_by', NEW.claimed_by));
    ELSIF NEW.claimed_by IS NULL AND OLD.claimed_by IS NOT NULL THEN
      INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
      VALUES (NEW.id, tbl, uid, 'released', jsonb_build_object('was_claimed_by', OLD.claimed_by));
    ELSE
      INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
      VALUES (NEW.id, tbl, uid, 'reassigned', jsonb_build_object('from', OLD.claimed_by, 'to', NEW.claimed_by));
    END IF;
  END IF;

  IF NEW.dispo IS DISTINCT FROM OLD.dispo THEN
    INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
    VALUES (NEW.id, tbl, uid, 'dispo_changed', jsonb_build_object('from', OLD.dispo, 'to', NEW.dispo));
  END IF;

  IF NEW.quoted_premium IS DISTINCT FROM OLD.quoted_premium THEN
    INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
    VALUES (NEW.id, tbl, uid, 'quoted_premium_changed', jsonb_build_object('from', OLD.quoted_premium, 'to', NEW.quoted_premium));
  END IF;

  IF NEW.agent_notes IS DISTINCT FROM OLD.agent_notes THEN
    INSERT INTO public.lead_activities(lead_id, lead_table, user_id, action, details)
    VALUES (NEW.id, tbl, uid, 'agent_notes_edited', '{}'::jsonb);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS log_lead_activity_leads ON public.leads;
CREATE TRIGGER log_lead_activity_leads AFTER UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.log_lead_activity();

DROP TRIGGER IF EXISTS log_lead_activity_list_leads ON public.list_leads;
CREATE TRIGGER log_lead_activity_list_leads AFTER UPDATE ON public.list_leads
  FOR EACH ROW EXECUTE FUNCTION public.log_lead_activity();