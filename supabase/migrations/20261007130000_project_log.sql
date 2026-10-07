-- Project log: dated entries of what was done, and who did it (ONE-141).
--
-- Decided 2026-10-06: a project keeps a dated log, such as "Mar 12: replaced
-- the igniter, Acme HVAC, $180, photo of the receipt". For a home record it is
-- the service history; for a build, the progress.
--
--   occurred_on              the day it was done
--   cost_cents, currency     a record of what it cost, never a payment
--                            (Working Agreement §6), in minor units as
--                            products.price_cents is
--   performed_by_profile_id  who did it: the profile that ties a private
--                            record back to discovery, one tap from its page
--
-- Up to four photos an entry, in project_log_media. An entry and its photos
-- are as visible as their project, and only its owner writes them. Being
-- named as who did the work is a claim about someone else's profile, so the
-- named profile may take its name off (remove_me_from_log_entry).

CREATE TABLE public.project_log_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    occurred_on DATE NOT NULL,
    title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
    notes TEXT CHECK (char_length(notes) <= 2000),
    cost_cents INTEGER CHECK (cost_cents >= 0),
    currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
    performed_by_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A project's log, newest first.
CREATE INDEX project_log_entries_project_id_occurred_on
    ON public.project_log_entries (project_id, occurred_on DESC);
-- The entries naming a profile, for its delete's SET NULL.
CREATE INDEX project_log_entries_performed_by_profile_id
    ON public.project_log_entries (performed_by_profile_id) WHERE performed_by_profile_id IS NOT NULL;

CREATE TRIGGER project_log_entries_set_updated_at
    BEFORE UPDATE ON public.project_log_entries
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.project_log_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES public.project_log_entries(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX project_log_media_entry_id_sort_order ON public.project_log_media (entry_id, sort_order);

-- ─── Four photos an entry ─────────────────────────────────────────────
--
-- Counted before each insert, with the entry locked so two saves at once
-- can't each see room for one more. A row-level BEFORE trigger sees the rows
-- its own statement inserted before it, so one insert of five is refused too.
-- SECURITY DEFINER so the count is every photo, whatever the writer may read.

CREATE OR REPLACE FUNCTION public.check_log_media_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.project_log_entries WHERE id = NEW.entry_id FOR UPDATE;
  IF (SELECT count(*) FROM public.project_log_media WHERE entry_id = NEW.entry_id) >= 4 THEN
    RAISE EXCEPTION 'a log entry holds at most 4 photos'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- A trigger function, never called directly.
REVOKE ALL ON FUNCTION public.check_log_media_count() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER project_log_media_check_count
    BEFORE INSERT ON public.project_log_media
    FOR EACH ROW EXECUTE FUNCTION public.check_log_media_count();

-- ─── RLS ──────────────────────────────────────────────────────────────
--
-- Read with the project: each EXISTS reads under the reader's RLS, so an entry
-- reaches whoever may see its project — anyone for a public one, a tag holder
-- for an unlisted one (ONE-137), its owner and Contributors for a private one
-- — and a photo whoever may see its entry. Written only by the project's
-- owner.

ALTER TABLE public.project_log_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_log_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Log entries are viewable with their project" ON public.project_log_entries
    FOR SELECT TO anon, authenticated
    USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_log_entries.project_id));

CREATE POLICY "Project owners can add log entries" ON public.project_log_entries
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_log_entries.project_id AND (SELECT public.owns_profile(p.owner_profile_id))
    ));

CREATE POLICY "Project owners can change log entries" ON public.project_log_entries
    FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_log_entries.project_id AND (SELECT public.owns_profile(p.owner_profile_id))
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_log_entries.project_id AND (SELECT public.owns_profile(p.owner_profile_id))
    ));

CREATE POLICY "Project owners can delete log entries" ON public.project_log_entries
    FOR DELETE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_log_entries.project_id AND (SELECT public.owns_profile(p.owner_profile_id))
    ));

CREATE POLICY "Log photos are viewable with their entry" ON public.project_log_media
    FOR SELECT TO anon, authenticated
    USING (EXISTS (SELECT 1 FROM public.project_log_entries e WHERE e.id = project_log_media.entry_id));

CREATE POLICY "Project owners can add log photos" ON public.project_log_media
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.project_log_entries e
        JOIN public.projects p ON p.id = e.project_id
        WHERE e.id = project_log_media.entry_id AND (SELECT public.owns_profile(p.owner_profile_id))
    ));

CREATE POLICY "Project owners can move log photos" ON public.project_log_media
    FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.project_log_entries e
        JOIN public.projects p ON p.id = e.project_id
        WHERE e.id = project_log_media.entry_id AND (SELECT public.owns_profile(p.owner_profile_id))
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.project_log_entries e
        JOIN public.projects p ON p.id = e.project_id
        WHERE e.id = project_log_media.entry_id AND (SELECT public.owns_profile(p.owner_profile_id))
    ));

CREATE POLICY "Project owners can remove log photos" ON public.project_log_media
    FOR DELETE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.project_log_entries e
        JOIN public.projects p ON p.id = e.project_id
        WHERE e.id = project_log_media.entry_id AND (SELECT public.owns_profile(p.owner_profile_id))
    ));

-- ─── Taking your name off an entry ────────────────────────────────────
--
-- The named profile isn't the entry's to write, so no policy lets it update
-- one; this does, for the one column, and only when the entry names one of
-- the caller's own profiles. The entry stays. True when a name was removed.

CREATE OR REPLACE FUNCTION public.remove_me_from_log_entry(p_entry_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.project_log_entries
  SET performed_by_profile_id = NULL
  WHERE id = p_entry_id
    AND performed_by_profile_id IS NOT NULL
    AND public.owns_profile(performed_by_profile_id);
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_me_from_log_entry(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_me_from_log_entry(UUID) TO authenticated;
