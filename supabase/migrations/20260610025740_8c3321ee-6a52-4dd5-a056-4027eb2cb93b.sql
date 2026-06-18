
-- 1) Revoke client read of Telnyx SIP credentials. Server (service_role) still reads them.
REVOKE SELECT (telnyx_sip_password, telnyx_sip_username, telnyx_number) ON public.profiles FROM authenticated;
REVOKE SELECT (telnyx_sip_password, telnyx_sip_username, telnyx_number) ON public.profiles FROM anon;

-- 2) Remove anon EXECUTE on SECURITY DEFINER functions.
REVOKE EXECUTE ON FUNCTION public.add_dispo_option(text, text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_sale_event(uuid, text, text, uuid, numeric, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_sale_event(uuid, text, text, uuid, numeric, text, text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_lead_shared_with(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.calc_lead_score(uuid, text, text, text, integer, text, text, date, timestamptz, text, text, text[], integer, integer, numeric, boolean, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.lead_lines_sold_trg() FROM PUBLIC, anon;

-- Ensure authenticated and service_role retain needed access.
GRANT EXECUTE ON FUNCTION public.is_lead_shared_with(uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_dispo_option(text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calc_lead_score(uuid, text, text, text, integer, text, text, date, timestamptz, text, text, text[], integer, integer, numeric, boolean, boolean, text) TO authenticated, service_role;
