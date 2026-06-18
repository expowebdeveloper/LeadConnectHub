DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sale_type') THEN
    CREATE TYPE public.sale_type AS ENUM ('monoline','bundled','bundled_preferred');
  END IF;
END $$;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS auto_sale_type public.sale_type,
  ADD COLUMN IF NOT EXISTS home_sale_type public.sale_type;

ALTER TABLE public.list_leads
  ADD COLUMN IF NOT EXISTS auto_sale_type public.sale_type,
  ADD COLUMN IF NOT EXISTS home_sale_type public.sale_type;