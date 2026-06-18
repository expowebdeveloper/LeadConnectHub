REVOKE SELECT (endpoint_password, endpoint_username) ON public.plivo_endpoints FROM anon, authenticated;
REVOKE INSERT (endpoint_password, endpoint_username) ON public.plivo_endpoints FROM anon, authenticated;
REVOKE UPDATE (endpoint_password, endpoint_username) ON public.plivo_endpoints FROM anon, authenticated;

REVOKE SELECT (bypass_litigator, default_lead_rate) ON public.profiles FROM anon, authenticated;
REVOKE INSERT (bypass_litigator, default_lead_rate) ON public.profiles FROM anon, authenticated;
REVOKE UPDATE (bypass_litigator, default_lead_rate) ON public.profiles FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE (endpoint_password, endpoint_username) ON public.plivo_endpoints TO service_role;
GRANT SELECT, INSERT, UPDATE (bypass_litigator, default_lead_rate) ON public.profiles TO service_role;