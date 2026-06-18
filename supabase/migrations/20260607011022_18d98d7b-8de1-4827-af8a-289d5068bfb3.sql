
-- 1) Disputes table
CREATE TABLE public.lead_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  lead_source text NOT NULL CHECK (lead_source IN ('live','list')),
  vendor_id uuid NOT NULL,
  submitted_by uuid NOT NULL,
  reason_category text NOT NULL,
  reason_details text,
  evidence_paths text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','rejected')),
  admin_notes text,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lead_disputes_lead_idx ON public.lead_disputes (lead_id, lead_source);
CREATE INDEX lead_disputes_vendor_idx ON public.lead_disputes (vendor_id);
CREATE INDEX lead_disputes_status_idx ON public.lead_disputes (status);

GRANT SELECT, INSERT, UPDATE ON public.lead_disputes TO authenticated;
GRANT ALL ON public.lead_disputes TO service_role;

ALTER TABLE public.lead_disputes ENABLE ROW LEVEL SECURITY;

-- Vendor can see disputes they own (their own vendor_id or their parent vendor's).
CREATE POLICY "Vendors view their disputes" ON public.lead_disputes
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR vendor_id = auth.uid()
  OR vendor_id = public.get_parent_vendor_id(auth.uid())
);

-- Vendor can submit a dispute scoped to their vendor account.
CREATE POLICY "Vendors create their disputes" ON public.lead_disputes
FOR INSERT TO authenticated
WITH CHECK (
  submitted_by = auth.uid()
  AND (
    vendor_id = auth.uid()
    OR vendor_id = public.get_parent_vendor_id(auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  )
);

-- Only admins can update (resolve, set status, admin_notes).
CREATE POLICY "Admins update disputes" ON public.lead_disputes
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER lead_disputes_touch_updated
BEFORE UPDATE ON public.lead_disputes
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) Storage policies for dispute-evidence bucket
-- (Bucket itself is created via the storage tool, not SQL.)
CREATE POLICY "Vendors read own dispute evidence"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'dispute-evidence'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] = public.get_parent_vendor_id(auth.uid())::text
  )
);

CREATE POLICY "Vendors upload own dispute evidence"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'dispute-evidence'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] = public.get_parent_vendor_id(auth.uid())::text
  )
);

CREATE POLICY "Vendors delete own dispute evidence"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'dispute-evidence'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] = public.get_parent_vendor_id(auth.uid())::text
  )
);
