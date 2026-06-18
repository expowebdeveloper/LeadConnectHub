
-- Add line_id support to lead_shares for per-line sharing
ALTER TABLE public.lead_shares ADD COLUMN IF NOT EXISTS line_id text;

-- Replace unique constraint to include line_id (NULL = whole-lead share)
ALTER TABLE public.lead_shares DROP CONSTRAINT IF EXISTS lead_shares_lead_id_lead_table_shared_with_key;
CREATE UNIQUE INDEX IF NOT EXISTS lead_shares_unique_per_line
  ON public.lead_shares (lead_id, lead_table, shared_with, COALESCE(line_id, ''));

CREATE INDEX IF NOT EXISTS idx_lead_shares_line
  ON public.lead_shares (lead_table, lead_id, line_id)
  WHERE line_id IS NOT NULL;

-- Helper: is the given user the claimer of a specific line inside lead_lines?
CREATE OR REPLACE FUNCTION public.is_line_claimer(
  _lead_id uuid, _lead_table text, _line_id text, _user_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lines jsonb;
  v_claimer uuid;
BEGIN
  IF _line_id IS NULL OR _user_id IS NULL THEN RETURN false; END IF;
  IF _lead_table = 'leads' THEN
    SELECT lead_lines INTO v_lines FROM public.leads WHERE id = _lead_id;
  ELSIF _lead_table = 'list_leads' THEN
    SELECT lead_lines INTO v_lines FROM public.list_leads WHERE id = _lead_id;
  ELSE
    RETURN false;
  END IF;
  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' THEN RETURN false; END IF;
  SELECT NULLIF(elem->>'claimed_by','')::uuid INTO v_claimer
  FROM jsonb_array_elements(v_lines) elem
  WHERE elem->>'line_id' = _line_id
  LIMIT 1;
  RETURN v_claimer IS NOT NULL AND v_claimer = _user_id;
END;
$$;

-- Extend is_lead_shared_with: line-scoped share OR whole-lead share both grant access
CREATE OR REPLACE FUNCTION public.is_lead_shared_with(_lead_id uuid, _lead_table text, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lead_shares
    WHERE lead_id = _lead_id
      AND lead_table = _lead_table
      AND shared_with = _user_id
  )
$$;

-- New helper specifically for per-line access check
CREATE OR REPLACE FUNCTION public.is_line_shared_with(
  _lead_id uuid, _lead_table text, _line_id text, _user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lead_shares
    WHERE lead_id = _lead_id
      AND lead_table = _lead_table
      AND shared_with = _user_id
      AND (line_id IS NULL OR line_id = _line_id)
  )
$$;

-- Replace policies to allow per-line shares: claimer of the lead OR claimer of the specific line OR admin
DROP POLICY IF EXISTS "Claimer or admin can create shares" ON public.lead_shares;
DROP POLICY IF EXISTS "Claimer, share recipient, or admin can delete shares" ON public.lead_shares;
DROP POLICY IF EXISTS "View shares you're part of or admin" ON public.lead_shares;

CREATE POLICY "Create shares: claimer (lead or line) or admin"
ON public.lead_shares FOR INSERT TO authenticated
WITH CHECK (
  shared_by = auth.uid()
  AND shared_with <> auth.uid()
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.is_lead_claimer(lead_id, lead_table, auth.uid())
    OR (line_id IS NOT NULL AND public.is_line_claimer(lead_id, lead_table, line_id, auth.uid()))
  )
);

CREATE POLICY "Delete shares: participant, claimer, or admin"
ON public.lead_shares FOR DELETE TO authenticated
USING (
  shared_with = auth.uid()
  OR shared_by = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.is_lead_claimer(lead_id, lead_table, auth.uid())
  OR (line_id IS NOT NULL AND public.is_line_claimer(lead_id, lead_table, line_id, auth.uid()))
);

CREATE POLICY "View shares: participant, claimer, or admin"
ON public.lead_shares FOR SELECT TO authenticated
USING (
  shared_with = auth.uid()
  OR shared_by = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.is_lead_claimer(lead_id, lead_table, auth.uid())
  OR (line_id IS NOT NULL AND public.is_line_claimer(lead_id, lead_table, line_id, auth.uid()))
);
