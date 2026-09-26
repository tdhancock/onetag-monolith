-- Saves, beyond posts (ONE-39).
--
-- A Save bookmarks a Post, a Product, a Project or a Profile for later — a
-- personal inspiration board. saved_posts held only posts. saves holds all
-- four the way tags hold destinations: one nullable foreign key per kind and
-- a check that exactly one is set — not a saved_type/saved_id pair, which can
-- carry no foreign key and leaves a save dangling when its target is deleted.
--
-- Saves belong to a profile, not an account: switching to a business profile
-- shows that profile's saves. They are private — a record of what someone is
-- interested in. Making them public would be its own deliberate decision with
-- its own flag, as scan history has (ONE-35); this migration makes none.
--
-- saved_posts' rows move here and the table goes, in this one migration, only
-- after the copy is counted. Its user_id already holds a profile id (the
-- multi-profile rewrite keyed every join table on profiles, ONE-21), so the
-- copy is direct.

CREATE TABLE public.saves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    saved_post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
    saved_product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    saved_project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    saved_profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT saves_one_target
        CHECK (num_nonnulls(saved_post_id, saved_product_id, saved_project_id, saved_profile_id) = 1)
);

-- A profile saves a target once. One partial unique index per kind: a single
-- composite index cannot do it, because nulls are distinct and every row has
-- three of them.
CREATE UNIQUE INDEX saves_profile_post ON public.saves (profile_id, saved_post_id) WHERE saved_post_id IS NOT NULL;
CREATE UNIQUE INDEX saves_profile_product ON public.saves (profile_id, saved_product_id) WHERE saved_product_id IS NOT NULL;
CREATE UNIQUE INDEX saves_profile_project ON public.saves (profile_id, saved_project_id) WHERE saved_project_id IS NOT NULL;
CREATE UNIQUE INDEX saves_profile_profile ON public.saves (profile_id, saved_profile_id) WHERE saved_profile_id IS NOT NULL;

-- A profile's saves, newest first.
CREATE INDEX saves_profile_id_saved_at ON public.saves (profile_id, saved_at DESC);

-- The reverse lookups, which the cascades use too.
CREATE INDEX saves_saved_post_id ON public.saves (saved_post_id) WHERE saved_post_id IS NOT NULL;
CREATE INDEX saves_saved_product_id ON public.saves (saved_product_id) WHERE saved_product_id IS NOT NULL;
CREATE INDEX saves_saved_project_id ON public.saves (saved_project_id) WHERE saved_project_id IS NOT NULL;
CREATE INDEX saves_saved_profile_id ON public.saves (saved_profile_id) WHERE saved_profile_id IS NOT NULL;

-- ─── Move saved_posts across, count, then drop it ─────────────────────

INSERT INTO public.saves (profile_id, saved_post_id, saved_at)
SELECT user_id, post_id, created_at FROM public.saved_posts;

DO $$
DECLARE
  held BIGINT;
  copied BIGINT;
BEGIN
  SELECT count(*) INTO held FROM public.saved_posts;
  SELECT count(*) INTO copied FROM public.saves WHERE saved_post_id IS NOT NULL;
  IF copied <> held THEN
    RAISE EXCEPTION 'saved_posts held % rows but saves received %; not dropping it', held, copied;
  END IF;
END;
$$;

DROP TABLE public.saved_posts;

-- ─── RLS: private to the profile that saved ───────────────────────────

ALTER TABLE public.saves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own saves" ON public.saves
    FOR SELECT TO authenticated USING ((SELECT public.owns_profile(profile_id)));

CREATE POLICY "Users can save as themselves" ON public.saves
    FOR INSERT TO authenticated WITH CHECK ((SELECT public.owns_profile(profile_id)));

CREATE POLICY "Users can remove own saves" ON public.saves
    FOR DELETE TO authenticated USING ((SELECT public.owns_profile(profile_id)));

-- No update policy: a save has nothing to edit.
