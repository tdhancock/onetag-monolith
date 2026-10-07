-- Project details: facts the owner defines (ONE-140).
--
-- Decided 2026-10-06: a project carries whatever its owner needs to keep, such
-- as Model number, Serial number, Filter size or Warranty until, rather than a
-- fixed schema. A detail is a label and a value, like a product's spec, and a
-- kind: a date is what a later reminder will read, and a link opens when
-- tapped.
--
--   kind        text, number, date or link; each value is checked against it
--   sort_order  the owner's order, as the project page shows them
--
-- A detail is as visible as its project, Public, Unlisted or Private: it is
-- read through the project, under the reader's own RLS.

-- ─── A real calendar date ─────────────────────────────────────────────
--
-- YYYY-MM-DD, and a day that exists: 2026-02-30 is refused. make_date raises
-- on a day that does not exist, so the answer is caught here and the CHECK
-- refuses the row with a check violation, not a date error.

CREATE OR REPLACE FUNCTION public.is_calendar_date(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_value IS NULL OR p_value !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN false;
  END IF;
  PERFORM make_date(substr(p_value, 1, 4)::int, substr(p_value, 6, 2)::int, substr(p_value, 9, 2)::int);
  RETURN true;
EXCEPTION
  WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RETURN false;
END;
$$;

-- A CHECK calls it as whoever writes the row, and only the signed-in write
-- details. Supabase grants every new public function to anon directly
-- (ONE-85), so both are revoked.
REVOKE EXECUTE ON FUNCTION public.is_calendar_date(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_calendar_date(TEXT) TO authenticated;

-- ─── project_details ──────────────────────────────────────────────────

CREATE TABLE public.project_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 40),
    kind TEXT NOT NULL CHECK (kind IN ('text', 'number', 'date', 'link')),
    -- An empty value is never saved: a template's unfilled labels stay in the form.
    value TEXT NOT NULL CHECK (char_length(btrim(value)) >= 1 AND char_length(value) <= 500),
    sort_order INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT project_details_value_fits_kind CHECK (
        CASE kind
            WHEN 'number' THEN value ~ '^-?\d+(\.\d+)?$'
            WHEN 'date' THEN public.is_calendar_date(value)
            WHEN 'link' THEN value ~ '^https?://'
            ELSE true
        END
    )
);

CREATE INDEX project_details_project_id_sort_order ON public.project_details (project_id, sort_order);

-- ─── RLS ──────────────────────────────────────────────────────────────
--
-- Read with the project: the EXISTS reads projects under the reader's RLS, so
-- a detail reaches whoever may see its project — anyone for a public one, a
-- tag holder for an unlisted one (ONE-137), its owner and contributors for a
-- private one — and nobody else. Written only by the project's owner.

ALTER TABLE public.project_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project details are viewable with their project" ON public.project_details
    FOR SELECT TO anon, authenticated
    USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_details.project_id));

CREATE POLICY "Project owners can add details" ON public.project_details
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_details.project_id AND (SELECT public.owns_profile(p.owner_profile_id))
    ));

CREATE POLICY "Project owners can change details" ON public.project_details
    FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_details.project_id AND (SELECT public.owns_profile(p.owner_profile_id))
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_details.project_id AND (SELECT public.owns_profile(p.owner_profile_id))
    ));

CREATE POLICY "Project owners can remove details" ON public.project_details
    FOR DELETE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_details.project_id AND (SELECT public.owns_profile(p.owner_profile_id))
    ));
