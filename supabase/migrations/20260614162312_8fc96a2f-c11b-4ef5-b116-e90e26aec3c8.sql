
-- 1. Table
CREATE TABLE public.lead_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_table text NOT NULL CHECK (lead_table IN ('leads','list_leads')),
  lead_id uuid NOT NULL,
  line_key text,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz
);
CREATE INDEX idx_lead_notes_thread ON public.lead_notes (lead_table, lead_id, line_key, created_at);
CREATE INDEX idx_lead_notes_author ON public.lead_notes (author_id);

-- 2. Grants
GRANT SELECT, INSERT, UPDATE ON public.lead_notes TO authenticated;
GRANT ALL ON public.lead_notes TO service_role;

-- 3. RLS
ALTER TABLE public.lead_notes ENABLE ROW LEVEL SECURITY;

-- Helper: can the current user access this lead for notes purposes?
CREATE OR REPLACE FUNCTION public.user_can_access_lead_for_notes(_lead_table text, _lead_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  ok  boolean := false;
BEGIN
  IF uid IS NULL THEN
    RETURN false;
  END IF;

  IF public.has_role(uid, 'admin'::app_role) OR public.has_role(uid, 'sales'::app_role) THEN
    RETURN true;
  END IF;

  IF _lead_table = 'leads' THEN
    SELECT (l.claimed_by = uid OR l.home_claimed_by = uid OR l.vendor_id = uid)
      INTO ok
      FROM public.leads l WHERE l.id = _lead_id;
  ELSIF _lead_table = 'list_leads' THEN
    SELECT (l.claimed_by = uid OR l.vendor_id = uid)
      INTO ok
      FROM public.list_leads l WHERE l.id = _lead_id;
  END IF;

  IF ok THEN RETURN true; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.lead_shares s
    WHERE s.lead_table = _lead_table AND s.lead_id = _lead_id AND s.shared_with = uid
  ) INTO ok;

  RETURN ok;
END;
$$;

CREATE POLICY "Read lead notes"
  ON public.lead_notes FOR SELECT TO authenticated
  USING (public.user_can_access_lead_for_notes(lead_table, lead_id));

CREATE POLICY "Insert own lead notes"
  ON public.lead_notes FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.user_can_access_lead_for_notes(lead_table, lead_id)
  );

CREATE POLICY "Edit own lead notes within 15 minutes"
  ON public.lead_notes FOR UPDATE TO authenticated
  USING (author_id = auth.uid() AND now() - created_at < interval '15 minutes')
  WITH CHECK (author_id = auth.uid() AND now() - created_at < interval '15 minutes');

-- 4. Backfill from existing agent_notes fields
-- leads: main agent_notes -> auto thread
INSERT INTO public.lead_notes (lead_table, lead_id, line_key, author_id, body, created_at)
SELECT 'leads', l.id, 'auto',
       COALESCE(l.claimed_by, l.vendor_id) AS author_id,
       btrim(l.agent_notes), COALESCE(l.updated_at, l.created_at, now())
FROM public.leads l
WHERE l.agent_notes IS NOT NULL AND btrim(l.agent_notes) <> ''
  AND COALESCE(l.claimed_by, l.vendor_id) IS NOT NULL;

-- leads: home_agent_notes -> home thread
INSERT INTO public.lead_notes (lead_table, lead_id, line_key, author_id, body, created_at)
SELECT 'leads', l.id, 'home',
       COALESCE(l.home_claimed_by, l.claimed_by, l.vendor_id) AS author_id,
       btrim(l.home_agent_notes), COALESCE(l.updated_at, l.created_at, now())
FROM public.leads l
WHERE l.home_agent_notes IS NOT NULL AND btrim(l.home_agent_notes) <> ''
  AND COALESCE(l.home_claimed_by, l.claimed_by, l.vendor_id) IS NOT NULL;

-- list_leads: agent_notes -> auto thread
INSERT INTO public.lead_notes (lead_table, lead_id, line_key, author_id, body, created_at)
SELECT 'list_leads', l.id, 'auto',
       COALESCE(l.claimed_by, l.vendor_id) AS author_id,
       btrim(l.agent_notes), COALESCE(l.updated_at, l.created_at, now())
FROM public.list_leads l
WHERE l.agent_notes IS NOT NULL AND btrim(l.agent_notes) <> ''
  AND COALESCE(l.claimed_by, l.vendor_id) IS NOT NULL;
