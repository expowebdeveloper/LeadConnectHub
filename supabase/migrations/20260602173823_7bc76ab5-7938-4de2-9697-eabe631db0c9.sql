
-- Canonicalize vendor company_name: group by normalized key and pick the most-common spelling
WITH vendor_profiles AS (
  SELECT p.id, p.company_name
  FROM public.profiles p
  JOIN public.user_roles r ON r.user_id = p.id
  WHERE r.role = 'vendor' AND p.company_name IS NOT NULL AND btrim(p.company_name) <> ''
),
normalized AS (
  SELECT
    id,
    company_name,
    btrim(regexp_replace(
      regexp_replace(
        regexp_replace(lower(company_name), '[^a-z0-9 ]+', ' ', 'g'),
        '\b(inc|llc|ltd|corp|co|company|the|group|agency|insurance|ins)\b', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )) AS norm_key
  FROM vendor_profiles
),
counts AS (
  SELECT norm_key, company_name, COUNT(*) AS c
  FROM normalized
  WHERE norm_key <> ''
  GROUP BY norm_key, company_name
),
canonical AS (
  SELECT DISTINCT ON (norm_key) norm_key, company_name AS canonical_name
  FROM counts
  ORDER BY norm_key, c DESC, length(company_name) DESC, company_name ASC
)
UPDATE public.profiles p
SET company_name = c.canonical_name
FROM normalized n
JOIN canonical c ON c.norm_key = n.norm_key
WHERE p.id = n.id
  AND p.company_name IS DISTINCT FROM c.canonical_name;
