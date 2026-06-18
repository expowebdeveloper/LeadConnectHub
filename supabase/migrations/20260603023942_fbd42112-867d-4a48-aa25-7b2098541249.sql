CREATE TABLE public.list_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL,
  import_batch_id uuid,
  source_row jsonb,
  first_name text,
  last_name text,
  phone text,
  date_of_birth date,
  street text,
  city text,
  state text,
  zip text,
  county text,
  current_carrier text,
  num_vehicles integer NOT NULL DEFAULT 0,
  vehicles jsonb NOT NULL DEFAULT '[]'::jsonb,
  vendor_notes text,
  dispo public.lead_dispo,
  quoted_premium numeric,
  current_premium numeric,
  agent_id uuid,
  agent_notes text,
  vendor_payout numeric,
  claimed_by uuid,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_list_leads_vendor_id ON public.list_leads (vendor_id);
CREATE INDEX idx_list_leads_import_batch ON public.list_leads (import_batch_id);
CREATE INDEX idx_list_leads_created_at ON public.list_leads (created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.list_leads TO authenticated;
GRANT ALL ON public.list_leads TO service_role;

ALTER TABLE public.list_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendors view own list leads, sales/admin view all"
  ON public.list_leads FOR SELECT TO authenticated
  USING (
    (vendor_id = auth.uid())
    OR public.has_role(auth.uid(), 'sales'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "Vendors insert own list leads"
  ON public.list_leads FOR INSERT TO authenticated
  WITH CHECK (
    (vendor_id = auth.uid())
    AND (
      public.has_role(auth.uid(), 'vendor'::app_role)
      OR public.has_role(auth.uid(), 'sales'::app_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
    )
  );

CREATE POLICY "Sales and admins update list leads"
  ON public.list_leads FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'sales'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "Vendors update own list leads"
  ON public.list_leads FOR UPDATE TO authenticated
  USING ((vendor_id = auth.uid()) AND public.has_role(auth.uid(), 'vendor'::app_role))
  WITH CHECK ((vendor_id = auth.uid()) AND public.has_role(auth.uid(), 'vendor'::app_role));

CREATE POLICY "Vendors delete own list leads"
  ON public.list_leads FOR DELETE TO authenticated
  USING ((vendor_id = auth.uid()) AND public.has_role(auth.uid(), 'vendor'::app_role));

CREATE POLICY "Admins delete list leads"
  ON public.list_leads FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_list_leads_updated_at
  BEFORE UPDATE ON public.list_leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_list_leads_default_payout
  BEFORE INSERT ON public.list_leads
  FOR EACH ROW EXECUTE FUNCTION public.apply_default_vendor_payout();

CREATE TRIGGER trg_list_leads_vendor_lock
  BEFORE UPDATE ON public.list_leads
  FOR EACH ROW EXECUTE FUNCTION public.prevent_vendor_agent_notes_update();

CREATE TRIGGER trg_list_leads_claim_transition
  BEFORE UPDATE ON public.list_leads
  FOR EACH ROW EXECUTE FUNCTION public.enforce_lead_claim_transition();
