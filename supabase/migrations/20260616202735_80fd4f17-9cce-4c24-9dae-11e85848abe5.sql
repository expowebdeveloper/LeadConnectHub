
CREATE OR REPLACE FUNCTION public.enforce_followup_has_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.dispo = 'follow_up' AND NEW.follow_up_at IS NULL THEN
    RAISE EXCEPTION 'Follow-up disposition requires a follow_up_at date (lead %)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME IN ('leads','list_leads') THEN
    IF NEW.home_dispo = 'follow_up' AND NEW.home_follow_up_at IS NULL THEN
      RAISE EXCEPTION 'Home follow-up disposition requires a home_follow_up_at date (lead %)', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_followup_has_date_leads ON public.leads;
CREATE TRIGGER enforce_followup_has_date_leads
  BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.enforce_followup_has_date();

DROP TRIGGER IF EXISTS enforce_followup_has_date_list_leads ON public.list_leads;
CREATE TRIGGER enforce_followup_has_date_list_leads
  BEFORE INSERT OR UPDATE ON public.list_leads
  FOR EACH ROW EXECUTE FUNCTION public.enforce_followup_has_date();
