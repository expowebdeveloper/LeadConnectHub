
CREATE TABLE public.lead_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  lead_table text NOT NULL CHECK (lead_table IN ('leads','list_leads')),
  shared_with uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, lead_table, shared_with)
);

CREATE INDEX idx_lead_shares_shared_with ON public.lead_shares(shared_with);
CREATE INDEX idx_lead_shares_lead ON public.lead_shares(lead_table, lead_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_shares TO authenticated;
GRANT ALL ON public.lead_shares TO service_role;

ALTER TABLE public.lead_shares ENABLE ROW LEVEL SECURITY;

-- Helper: is the current user the claimer of this lead?
CREATE OR REPLACE FUNCTION public.is_lead_claimer(_lead_id uuid, _lead_table text, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE c uuid;
BEGIN
  IF _lead_table = 'leads' THEN
    SELECT claimed_by INTO c FROM public.leads WHERE id = _lead_id;
  ELSIF _lead_table = 'list_leads' THEN
    SELECT claimed_by INTO c FROM public.list_leads WHERE id = _lead_id;
  ELSE
    RETURN false;
  END IF;
  RETURN c IS NOT NULL AND c = _user_id;
END;
$$;

CREATE POLICY "View shares you're part of or admin"
  ON public.lead_shares FOR SELECT TO authenticated
  USING (
    shared_with = auth.uid()
    OR shared_by = auth.uid()
    OR public.is_lead_claimer(lead_id, lead_table, auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Claimer or admin can create shares"
  ON public.lead_shares FOR INSERT TO authenticated
  WITH CHECK (
    shared_by = auth.uid()
    AND shared_with <> auth.uid()
    AND (
      public.is_lead_claimer(lead_id, lead_table, auth.uid())
      OR public.has_role(auth.uid(), 'admin')
    )
  );

CREATE POLICY "Claimer, share recipient, or admin can delete shares"
  ON public.lead_shares FOR DELETE TO authenticated
  USING (
    shared_with = auth.uid()
    OR shared_by = auth.uid()
    OR public.is_lead_claimer(lead_id, lead_table, auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );
