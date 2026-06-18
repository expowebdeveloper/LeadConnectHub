CREATE TABLE public.goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('agency','agent')),
  agent_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period IN ('weekly','monthly','quarterly','yearly')),
  metric text NOT NULL CHECK (metric IN ('policies','items','premium')),
  target numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'agency' AND agent_id IS NULL) OR (scope = 'agent' AND agent_id IS NOT NULL))
);

CREATE UNIQUE INDEX goals_agency_unique ON public.goals (period, metric) WHERE scope = 'agency';
CREATE UNIQUE INDEX goals_agent_unique ON public.goals (agent_id, period, metric) WHERE scope = 'agent';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.goals TO authenticated;
GRANT ALL ON public.goals TO service_role;

ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read goals" ON public.goals
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage goals" ON public.goals
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER goals_touch_updated_at
  BEFORE UPDATE ON public.goals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();