alter table public.profiles
  add column if not exists notification_prefs jsonb not null default
    '{"sale_toast": true, "sale_sound": true, "sale_email": true}'::jsonb;

update public.profiles
set notification_prefs = '{"sale_toast": true, "sale_sound": true, "sale_email": true}'::jsonb
where notification_prefs is null;