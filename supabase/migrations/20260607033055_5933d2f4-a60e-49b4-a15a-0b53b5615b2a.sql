DO $outer$
DECLARE
  job_id bigint;
BEGIN
  SELECT jobid INTO job_id
  FROM cron.job
  WHERE jobname = 'process-email-queue'
  ORDER BY jobid DESC
  LIMIT 1;

  IF job_id IS NULL THEN
    RAISE EXCEPTION 'process-email-queue job not found';
  END IF;

  PERFORM cron.unschedule(job_id);

  PERFORM cron.schedule(
    'process-email-queue',
    '5 seconds',
    $cmd$
    SELECT CASE
      WHEN (SELECT retry_after_until FROM public.email_send_state WHERE id = 1) > now()
        THEN NULL
      WHEN EXISTS (SELECT 1 FROM pgmq.q_auth_emails LIMIT 1)
        OR EXISTS (SELECT 1 FROM pgmq.q_transactional_emails LIMIT 1)
        THEN net.http_post(
          url := 'https://jet-leads.lovable.app/lovable/email/queue/process',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              SELECT decrypted_secret FROM vault.decrypted_secrets
              WHERE name = 'email_queue_service_role_key'
            )
          ),
          body := '{}'::jsonb
        )
      ELSE NULL
    END;
    $cmd$
  );
END
$outer$;