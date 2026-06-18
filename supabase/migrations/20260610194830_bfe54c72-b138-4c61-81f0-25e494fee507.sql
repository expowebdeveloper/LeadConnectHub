SET session_replication_role = replica;
UPDATE public.list_leads
   SET composite_score = 99999,
       score_tier = 'S'
 WHERE first_name = 'Jane' AND last_name = 'Doe';
SET session_replication_role = origin;