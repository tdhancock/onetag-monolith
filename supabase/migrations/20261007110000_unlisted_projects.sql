-- Unlisted projects: readable by whoever holds their tag (ONE-137).
--
-- Decided 2026-10-06: a third visibility beside Public and Private. Personal
-- records — a home and what's in it — stay out of Explore, search and
-- profiles, but anyone who holds the item's tag can read it: the plumber
-- scanning the water heater.
--
-- Why not a policy that lets anyone read an unlisted row: it would also let
-- anyone list every unlisted row (select * from projects), every home's
-- inventory. Access is tied to something only a tag holder has. Scanning or
-- opening the tag in the app records a grant; the read policy honours a grant
-- only while its tag is still active and still points here, or at the
-- project this one sits inside (ONE-134). Pausing the tag ends it.
--
--   projects.unlisted          never with is_public, so every is_public
--                              filter already leaves an unlisted project out
--   project_tag_grants         who opened which tag; no policies, written and
--                              read only by the functions below
--   grant_project_tag_access   records a grant for the caller's own profile
--   can_read_unlisted_project  the read policy's test
--   resolve_tag                also says whether a project destination is
--                              unlisted, so the app knows to grant, or to ask
--                              someone signed out to sign in

ALTER TABLE public.projects
    ADD COLUMN unlisted BOOLEAN NOT NULL DEFAULT false,
    ADD CONSTRAINT projects_unlisted_not_public CHECK (NOT (is_public AND unlisted));

COMMENT ON COLUMN public.projects.unlisted IS
    'Unlisted (ONE-137): never shown in Explore, search or on a profile, readable by whoever opened one of its tags. Never also public.';

-- ─── Grants ───────────────────────────────────────────────────────────

CREATE TABLE public.project_tag_grants (
    tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tag_id, profile_id)
);

-- The read policy looks grants up by profile.
CREATE INDEX project_tag_grants_profile_id ON public.project_tag_grants (profile_id);

-- No policies: nobody reads or writes this table directly.
ALTER TABLE public.project_tag_grants ENABLE ROW LEVEL SECURITY;

-- ─── Recording a grant ────────────────────────────────────────────────
--
-- For the caller's own profile, through a tag that is active, Physical or
-- Digital, and points at an unlisted project. Anything else does nothing:
-- a public project needs no grant, and a private one is never opened by a
-- tag. Repeating it changes nothing. Returns whether the caller now holds a
-- grant through that tag.

CREATE OR REPLACE FUNCTION public.grant_project_tag_access(p_short_code TEXT, p_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  granted_tag UUID;
BEGIN
  IF NOT public.owns_profile(p_profile_id) THEN
    RETURN false;
  END IF;

  SELECT t.id INTO granted_tag
  FROM public.tags t
  JOIN public.projects pj ON pj.id = t.dest_project_id
  WHERE t.short_code = p_short_code
    AND t.active
    AND t.tag_type IN ('physical', 'digital')
    AND pj.unlisted;

  IF granted_tag IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.project_tag_grants (tag_id, profile_id)
  VALUES (granted_tag, p_profile_id)
  ON CONFLICT DO NOTHING;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_project_tag_access(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_project_tag_access(TEXT, UUID) TO authenticated;

-- ─── Reading through a grant ──────────────────────────────────────────
--
-- True when the project is unlisted and one of the caller's profiles holds a
-- grant through a tag that is still active and points at this project or at
-- the project it sits inside: the house's tag opens its unlisted furnace,
-- never a private one. SECURITY DEFINER to read grants and tags past their
-- RLS; it answers yes or no about the caller and one project, and nothing
-- else. Signed-in callers only: anon has no profile to hold a grant.

CREATE OR REPLACE FUNCTION public.can_read_unlisted_project(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects pj
    JOIN public.tags t
      ON t.active AND (t.dest_project_id = pj.id OR t.dest_project_id = pj.parent_project_id)
    JOIN public.project_tag_grants g ON g.tag_id = t.id
    WHERE pj.id = p_project_id
      AND pj.unlisted
      AND public.owns_profile(g.profile_id)
  );
$$;

REVOKE ALL ON FUNCTION public.can_read_unlisted_project(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_unlisted_project(UUID) TO authenticated;

-- Contributors, project_products and every table read "with its project"
-- follow this, since their own policies query projects under the caller's RLS.
CREATE POLICY "Tag holders can view unlisted projects" ON public.projects
    FOR SELECT TO authenticated
    USING (unlisted AND public.can_read_unlisted_project(id));

-- ─── Resolution ───────────────────────────────────────────────────────
--
-- As ONE-135 left it (20261006120000_blank_tags.sql), with one more column:
-- whether an active tag's project destination is unlisted. Null for any other
-- destination, and for a paused tag, which still reveals nothing.
--
-- CREATE OR REPLACE cannot change a function's result columns, so it is
-- dropped and recreated, and its grants restated.

DROP FUNCTION public.resolve_tag(TEXT);

CREATE FUNCTION public.resolve_tag(p_short_code TEXT)
RETURNS TABLE (
    tag_id UUID,
    active BOOLEAN,
    dest_profile_id UUID,
    dest_profile_username TEXT,
    dest_product_id UUID,
    dest_project_id UUID,
    dest_post_id UUID,
    dest_post_username TEXT,
    linked BOOLEAN,
    owned_by_caller BOOLEAN,
    dest_project_unlisted BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    CASE
      WHEN NOT t.active THEN NULL
      WHEN t.is_linked OR t.is_owned THEN t.id
    END,
    t.active,
    CASE WHEN t.active THEN t.dest_profile_id END,
    CASE WHEN t.active THEN p.username END,
    CASE WHEN t.active THEN t.dest_product_id END,
    CASE WHEN t.active THEN t.dest_project_id END,
    -- Returned for any post, as for a private project: the post screen
    -- decides who sees it. The handle is the tag owner's own, since a
    -- Physical or Digital Tag only points at its owner's posts.
    CASE WHEN t.active THEN t.dest_post_id END,
    CASE WHEN t.active THEN author.username END,
    CASE WHEN t.active THEN t.is_linked END,
    CASE WHEN t.active THEN t.is_owned END,
    CASE WHEN t.active AND t.dest_project_id IS NOT NULL THEN pj.unlisted END
  FROM (
    SELECT
      tags.*,
      num_nonnulls(tags.dest_profile_id, tags.dest_product_id, tags.dest_project_id, tags.dest_post_id) = 1 AS is_linked,
      public.owns_profile(tags.owner_profile_id) AS is_owned
    FROM public.tags
    WHERE tags.short_code = p_short_code
      AND tags.tag_type <> 'embedded'
  ) t
  LEFT JOIN public.profiles p ON p.id = t.dest_profile_id
  LEFT JOIN public.posts po ON po.id = t.dest_post_id
  LEFT JOIN public.profiles author ON author.id = po.user_id
  LEFT JOIN public.projects pj ON pj.id = t.dest_project_id;
$$;

-- Resolution must work without an account: a stranger scanning a sticker.
REVOKE ALL ON FUNCTION public.resolve_tag(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_tag(TEXT) TO anon, authenticated;
