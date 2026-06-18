
-- 7. Composite index for the hottest list_leads reads
CREATE INDEX IF NOT EXISTS idx_list_leads_queue
  ON public.list_leads (claimed_by, archived_at, transferred_lead_id, composite_score DESC NULLS LAST);

-- 3. Revoke EXECUTE from authenticated/anon/public on internal trigger functions.
-- These are invoked automatically by table triggers and were never meant to be
-- callable directly via the Data API.
REVOKE EXECUTE ON FUNCTION public.apply_default_vendor_payout()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.coerce_lead_vendor_to_parent()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_lead_claim_transition()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.leads_on_sold_trg()                        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.leads_score_trg()                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.list_leads_score_trg()                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_lead_activity()                        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_vendor_agent_notes_update()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_vendor_sensitive_profile_changes() FROM PUBLIC, anon, authenticated;
