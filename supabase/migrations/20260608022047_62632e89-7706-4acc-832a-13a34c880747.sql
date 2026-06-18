
-- 1. Replace the "View list leads" policy: remove the telemarketer "claimed_by IS NULL" branch
DROP POLICY IF EXISTS "View list leads" ON public.list_leads;
CREATE POLICY "View list leads"
ON public.list_leads
FOR SELECT
TO authenticated
USING (
  vendor_id = auth.uid()
  OR has_role(auth.uid(), 'sales'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR (
    has_role(auth.uid(), 'telemarketer'::app_role)
    AND claimed_by = auth.uid()
  )
);

-- 2. Atomic claim RPC used by telemarketer UI
CREATE OR REPLACE FUNCTION public.claim_list_lead(p_id uuid)
RETURNS public.list_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  claimed public.list_leads;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(uid, 'telemarketer'::app_role)
          OR public.has_role(uid, 'sales'::app_role)
          OR public.has_role(uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden — not allowed to claim list leads';
  END IF;

  UPDATE public.list_leads
  SET claimed_by = uid,
      claimed_at = now()
  WHERE id = p_id
    AND claimed_by IS NULL
    AND archived_at IS NULL
  RETURNING * INTO claimed;

  IF claimed.id IS NULL THEN
    RAISE EXCEPTION 'Lead is no longer available' USING ERRCODE = 'P0002';
  END IF;

  RETURN claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_list_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_list_lead(uuid) TO authenticated;
