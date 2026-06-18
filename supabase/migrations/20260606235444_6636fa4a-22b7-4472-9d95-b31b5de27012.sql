ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS agent_type text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_agent_type_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_agent_type_check
  CHECK (agent_type IS NULL OR agent_type IN ('homie','autobot','service'));