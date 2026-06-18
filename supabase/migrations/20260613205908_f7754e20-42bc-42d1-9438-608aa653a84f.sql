ALTER TABLE public.profiles DROP COLUMN IF EXISTS telnyx_number, DROP COLUMN IF EXISTS telnyx_sip_username, DROP COLUMN IF EXISTS telnyx_sip_password;
ALTER TABLE public.call_logs DROP COLUMN IF EXISTS telnyx_call_control_id, DROP COLUMN IF EXISTS telnyx_call_leg_id, DROP COLUMN IF EXISTS telnyx_call_session_id;
DROP TABLE IF EXISTS public.telnyx_webhook_events;