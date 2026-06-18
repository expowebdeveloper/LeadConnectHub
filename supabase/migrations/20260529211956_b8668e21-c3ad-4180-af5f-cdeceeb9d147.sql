
ALTER TABLE public.profiles ADD COLUMN default_lead_rate numeric;

CREATE OR REPLACE FUNCTION public.apply_default_vendor_payout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.vendor_payout IS NULL THEN
    SELECT default_lead_rate INTO NEW.vendor_payout
    FROM public.profiles
    WHERE id = NEW.vendor_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_apply_default_payout ON public.leads;
CREATE TRIGGER leads_apply_default_payout
BEFORE INSERT ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.apply_default_vendor_payout();
