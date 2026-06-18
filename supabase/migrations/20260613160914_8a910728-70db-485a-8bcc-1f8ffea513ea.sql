REVOKE EXECUTE ON FUNCTION public.calc_lead_score(
  p_vendor_id uuid, p_phone text, p_email text, p_housing_status text,
  p_num_vehicles integer, p_auto_carrier text, p_home_carrier text,
  p_date_of_birth date, p_created_at timestamp with time zone, p_dispo text,
  p_home_dispo text, p_lead_types text[], p_year_built integer,
  p_square_feet integer, p_dwelling_value numeric, p_is_list_source boolean,
  p_is_aged_source boolean, p_list_type text, p_construction_type text,
  p_roof_year integer, p_roof_type text, p_flood_zone text,
  p_has_pool boolean, p_has_trampoline boolean
) FROM PUBLIC, anon;