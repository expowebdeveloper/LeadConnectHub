ALTER TYPE public.lead_dispo ADD VALUE IF NOT EXISTS 'voicemail';

INSERT INTO public.dispo_options (value, label, sort_order, enabled, is_system)
VALUES ('voicemail', 'VM', 35, true, true)
ON CONFLICT (value) DO UPDATE
  SET label = EXCLUDED.label,
      sort_order = EXCLUDED.sort_order,
      enabled = true,
      is_system = true;