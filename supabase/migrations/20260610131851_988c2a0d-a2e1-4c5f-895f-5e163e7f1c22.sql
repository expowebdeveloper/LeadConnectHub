UPDATE public.scoring_weights
SET weights = weights || jsonb_build_object('tier_aged_penalty', 0)
WHERE id = 1;

UPDATE public.list_leads SET updated_at = now()
WHERE claimed_by IS NULL AND archived_at IS NULL;

UPDATE public.leads SET updated_at = now()
WHERE claimed_by IS NULL AND home_claimed_by IS NULL AND archived_at IS NULL;
