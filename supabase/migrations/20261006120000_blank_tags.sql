-- Blank Physical Tags: a destination set once, after printing (ONE-135).
--
-- Decided 2026-10-06. A Physical Tag may be created with no destination,
-- printed, stuck on something, and Linked to a Destination later — once. A
-- sheet of codes goes on a house before anything in it is in the app; each
-- is linked when it is first scanned.
--
-- What ONE-86 protects still holds. Once a tag has a destination it never
-- changes, so a sticker never starts sending people somewhere new; a tag
-- that should go elsewhere is replaced, not edited. The only change allowed
-- is the first one, from no destination to exactly one.
--
--   tags_one_destination  exactly one destination, or none for a Physical Tag
--   protect_tag_identity  a destination may be set once, from none
--   tag_accepts_scans     a blank tag records no Scan: there is nowhere it
--                         was scanned to, and the tag host records Scans too
--   resolve_tag           says whether a tag is linked, and whether the
--                         caller owns it, so the app can offer its owner the
--                         link and tell anyone else it isn't set up yet
--
-- The insert and update policies need no change: they already accept a null
-- destination column and check that the account owns any column that is set.

-- ─── Exactly one destination, or none for a Physical Tag ──────────────

ALTER TABLE public.tags DROP CONSTRAINT tags_one_destination;
ALTER TABLE public.tags ADD CONSTRAINT tags_one_destination
    CHECK (
        num_nonnulls(dest_profile_id, dest_product_id, dest_project_id, dest_post_id) = 1
        OR (tag_type = 'physical'
            AND num_nonnulls(dest_profile_id, dest_product_id, dest_project_id, dest_post_id) = 0)
    );

COMMENT ON CONSTRAINT tags_one_destination ON public.tags IS
    'Exactly one destination, of the five kinds: a profile (Business or Individual), a product, a project or a post. A Physical Tag may have none until it is linked, once (ONE-135).';

-- ─── A destination is set once ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.protect_tag_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  -- The same definition protect_profile_verified and protect_profile_type use.
  privileged BOOLEAN := current_user IN ('postgres', 'supabase_admin', 'service_role')
                        OR coalesce(auth.role(), 'service_role') = 'service_role';
  linking BOOLEAN;
BEGIN
  IF privileged THEN
    RETURN NEW;
  END IF;

  -- A blank tag being linked: no destination before, exactly one after.
  linking := num_nonnulls(OLD.dest_profile_id, OLD.dest_product_id, OLD.dest_project_id, OLD.dest_post_id) = 0
             AND num_nonnulls(NEW.dest_profile_id, NEW.dest_product_id, NEW.dest_project_id, NEW.dest_post_id) = 1;

  IF NEW.short_code IS DISTINCT FROM OLD.short_code THEN
    RAISE EXCEPTION 'a tag''s short_code cannot be changed once it exists'
      USING ERRCODE = '42501';
  END IF;

  -- Every destination column. A new destination kind adds its column here,
  -- beside tags_one_destination.
  IF (NEW.dest_profile_id IS DISTINCT FROM OLD.dest_profile_id
      OR NEW.dest_product_id IS DISTINCT FROM OLD.dest_product_id
      OR NEW.dest_project_id IS DISTINCT FROM OLD.dest_project_id
      OR NEW.dest_post_id IS DISTINCT FROM OLD.dest_post_id)
     AND NOT linking THEN
    RAISE EXCEPTION 'a tag''s destination cannot be changed once it has one; create a replacement instead'
      USING ERRCODE = '42501';
  END IF;

  -- The post an embedded tag sits in (ONE-44). Moving a tag to another post
  -- is a new tag, as a new destination is.
  IF NEW.host_post_id IS DISTINCT FROM OLD.host_post_id THEN
    RAISE EXCEPTION 'an embedded tag''s post cannot be changed once it exists'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.tag_type IS DISTINCT FROM OLD.tag_type THEN
    RAISE EXCEPTION 'a tag''s type cannot be changed once it exists'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.owner_profile_id IS DISTINCT FROM OLD.owner_profile_id THEN
    RAISE EXCEPTION 'a tag''s owner cannot be changed once it exists'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_tag_identity() IS
    'Freezes a tag''s short_code, type, owner, host post and destination after insert. A blank Physical Tag''s destination may be set once, from none (ONE-135). A new destination kind adds its column here.';

-- ─── A blank tag records no Scan ──────────────────────────────────────
--
-- CREATE OR REPLACE keeps the grants: anon and authenticated, since a
-- stranger scanning a sticker records a Scan.

CREATE OR REPLACE FUNCTION public.tag_accepts_scans(p_tag_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tags
    WHERE id = p_tag_id
      AND active
      AND num_nonnulls(dest_profile_id, dest_product_id, dest_project_id, dest_post_id) = 1
  );
$$;

-- ─── Resolution ───────────────────────────────────────────────────────
--
-- As before, with two more columns. `linked` is false for an active blank
-- tag. `owned_by_caller` says whether the caller's account owns the tag —
-- only ever about the caller, so it tells nobody anything about anyone else.
-- A blank tag's id goes to its owner alone, who needs it to link the tag;
-- anyone else learns only that it isn't set up yet. An inactive tag still
-- reveals nothing.
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
    owned_by_caller BOOLEAN
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
    CASE WHEN t.active THEN t.is_owned END
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
  LEFT JOIN public.profiles author ON author.id = po.user_id;
$$;

-- Resolution must work without an account: a stranger scanning a sticker.
REVOKE ALL ON FUNCTION public.resolve_tag(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_tag(TEXT) TO anon, authenticated;
