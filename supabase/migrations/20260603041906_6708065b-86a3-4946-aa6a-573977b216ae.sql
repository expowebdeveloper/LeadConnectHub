-- 1) Remove the two duplicate import batches
DELETE FROM public.list_leads
WHERE import_batch_id IN (
  '594da00f-8041-4f10-9889-0e64720b8034',
  'bb661d46-472e-45a8-b60a-1086af704db6'
);

-- 2) Dedupe remaining rows by phone, keeping the earliest created row per phone
DELETE FROM public.list_leads a
USING public.list_leads b
WHERE a.phone IS NOT NULL
  AND a.phone = b.phone
  AND (a.created_at > b.created_at
       OR (a.created_at = b.created_at AND a.id > b.id));

-- 3) Prevent future duplicate phone numbers
CREATE UNIQUE INDEX IF NOT EXISTS list_leads_phone_unique
  ON public.list_leads (phone)
  WHERE phone IS NOT NULL;