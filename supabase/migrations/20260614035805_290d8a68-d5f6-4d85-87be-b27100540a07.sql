-- Replace bytea with plain text + column-level access control.
ALTER TABLE public.plivo_endpoints DROP COLUMN endpoint_password_enc;
ALTER TABLE public.plivo_endpoints ADD COLUMN endpoint_password text NOT NULL DEFAULT '';

-- Lock direct selects to safe columns only; password reads must go through server fns w/ service role.
REVOKE SELECT ON public.plivo_endpoints FROM authenticated;
GRANT SELECT (user_id, endpoint_username, endpoint_alias, caller_id, created_at, updated_at)
  ON public.plivo_endpoints TO authenticated;
