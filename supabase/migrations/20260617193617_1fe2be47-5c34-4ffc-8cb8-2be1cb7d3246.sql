
CREATE INDEX IF NOT EXISTS idx_leads_phone_sold ON public.leads (phone) WHERE dispo = 'sold' OR home_dispo = 'sold';

DO $$
DECLARE affected int; loops int := 0;
BEGIN
  LOOP
    UPDATE public.list_leads
       SET updated_at = clock_timestamp()
     WHERE id IN (
       SELECT id FROM public.list_leads
        WHERE scored_at < '2026-06-17 19:33:00'::timestamptz
          AND NOT (dispo = 'follow_up' AND follow_up_at IS NULL)
          AND NOT (home_dispo = 'follow_up' AND home_follow_up_at IS NULL)
        ORDER BY id
        LIMIT 500
     );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
    loops := loops + 1;
    EXIT WHEN loops > 50;
  END LOOP;

  loops := 0;
  LOOP
    UPDATE public.leads
       SET updated_at = clock_timestamp()
     WHERE id IN (
       SELECT id FROM public.leads
        WHERE scored_at < '2026-06-17 19:33:00'::timestamptz
          AND NOT (dispo = 'follow_up' AND follow_up_at IS NULL)
          AND NOT (home_dispo = 'follow_up' AND home_follow_up_at IS NULL)
        ORDER BY id
        LIMIT 500
     );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
    loops := loops + 1;
    EXIT WHEN loops > 50;
  END LOOP;
END $$;
