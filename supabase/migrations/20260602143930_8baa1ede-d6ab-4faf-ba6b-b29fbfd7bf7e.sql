ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS claimed_by uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_leads_claimed_by ON public.leads(claimed_by);

-- Prevent stealing a claim from another agent (must unclaim first).
CREATE OR REPLACE FUNCTION public.enforce_lead_claim_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.claimed_by IS DISTINCT FROM OLD.claimed_by THEN
    -- Admins can override freely
    IF public.has_role(auth.uid(), 'admin') THEN
      RETURN NEW;
    END IF;
    -- Allow claim only if currently unclaimed, or release by current claimer
    IF OLD.claimed_by IS NOT NULL
       AND NEW.claimed_by IS NOT NULL
       AND OLD.claimed_by <> auth.uid() THEN
      RAISE EXCEPTION 'This lead is already claimed by another agent';
    END IF;
    IF OLD.claimed_by IS NOT NULL
       AND NEW.claimed_by IS NULL
       AND OLD.claimed_by <> auth.uid() THEN
      RAISE EXCEPTION 'Only the agent who claimed this lead can release it';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_lead_claim_transition ON public.leads;
CREATE TRIGGER enforce_lead_claim_transition
BEFORE UPDATE OF claimed_by ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.enforce_lead_claim_transition();