
-- Health probe: returns queue depths and any messages older than stall_minutes.
CREATE OR REPLACE FUNCTION public.email_queue_health(stall_minutes integer DEFAULT 3)
RETURNS TABLE (
  auth_depth bigint,
  transactional_depth bigint,
  stalled_count bigint,
  oldest_age_seconds numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pgmq, public
AS $$
DECLARE
  v_auth_depth bigint := 0;
  v_tx_depth bigint := 0;
  v_stalled bigint := 0;
  v_oldest numeric := 0;
BEGIN
  BEGIN
    SELECT count(*) INTO v_auth_depth FROM pgmq.q_auth_emails;
  EXCEPTION WHEN undefined_table THEN v_auth_depth := 0;
  END;

  BEGIN
    SELECT count(*) INTO v_tx_depth FROM pgmq.q_transactional_emails;
  EXCEPTION WHEN undefined_table THEN v_tx_depth := 0;
  END;

  BEGIN
    SELECT
      count(*) FILTER (WHERE enqueued_at < now() - make_interval(mins => stall_minutes)),
      COALESCE(EXTRACT(EPOCH FROM (now() - min(enqueued_at))), 0)
    INTO v_stalled, v_oldest
    FROM (
      SELECT enqueued_at FROM pgmq.q_auth_emails
      UNION ALL
      SELECT enqueued_at FROM pgmq.q_transactional_emails
    ) q;
  EXCEPTION WHEN undefined_table THEN
    v_stalled := 0; v_oldest := 0;
  END;

  RETURN QUERY SELECT v_auth_depth, v_tx_depth, v_stalled, v_oldest;
END;
$$;

GRANT EXECUTE ON FUNCTION public.email_queue_health(integer) TO service_role, authenticated;

-- Schedule the health-check hook every 5 minutes.
SELECT cron.unschedule('email-health-monitor')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-health-monitor');

SELECT cron.schedule(
  'email-health-monitor',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://jet-leads.lovable.app/api/public/hooks/email-health',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $cron$
);
