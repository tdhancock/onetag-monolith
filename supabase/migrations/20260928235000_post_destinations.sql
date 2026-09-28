-- A Tag can point to a post.
--
-- Decided 2026-09-28: a post is a Destination, the fifth kind beside the two
-- kinds of profile, products and projects. ONE-83 had ruled it out. A post's
-- link is a tag as much as a profile's is.
--
--   dest_post_id        the post a tag points to; deleting the post deletes
--                       the tags that point to it, as for every other kind
--   Physical, Digital   only to a post of your own, as every kind is
--   Embedded            to any post the author can see, never the photo's
--                       own post; the post's author can take it off, as a
--                       product's or project's owner can
--   resolve_tag         returns the post and its author's handle, which the
--                       web page names it by: it can't read the post itself
--   scan_history        lists a scanned post by its author, never its text,
--                       since the history may be public and the post not
--
-- A new destination column goes in tags_one_destination and in
-- protect_tag_identity, as that function asks.

ALTER TABLE public.tags
    ADD COLUMN dest_post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE;

CREATE INDEX tags_dest_post_id ON public.tags (dest_post_id) WHERE dest_post_id IS NOT NULL;

ALTER TABLE public.tags DROP CONSTRAINT tags_one_destination;
ALTER TABLE public.tags ADD CONSTRAINT tags_one_destination
    CHECK (num_nonnulls(dest_profile_id, dest_product_id, dest_project_id, dest_post_id) = 1);

-- ─── A destination never changes ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.protect_tag_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  -- The same definition protect_profile_verified and protect_profile_type use.
  privileged BOOLEAN := current_user IN ('postgres', 'supabase_admin', 'service_role')
                        OR coalesce(auth.role(), 'service_role') = 'service_role';
BEGIN
  IF privileged THEN
    RETURN NEW;
  END IF;

  IF NEW.short_code IS DISTINCT FROM OLD.short_code THEN
    RAISE EXCEPTION 'a tag''s short_code cannot be changed once it exists'
      USING ERRCODE = '42501';
  END IF;

  -- Every destination column. A new destination kind adds its column here,
  -- beside tags_one_destination.
  IF NEW.dest_profile_id IS DISTINCT FROM OLD.dest_profile_id
     OR NEW.dest_product_id IS DISTINCT FROM OLD.dest_product_id
     OR NEW.dest_project_id IS DISTINCT FROM OLD.dest_project_id
     OR NEW.dest_post_id IS DISTINCT FROM OLD.dest_post_id THEN
    RAISE EXCEPTION 'a tag''s destination cannot be changed once it exists; create a replacement instead'
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

-- ─── Physical and Digital: your own destinations ──────────────────────

DROP POLICY "Users can create tags to own destinations" ON public.tags;
CREATE POLICY "Users can create tags to own destinations" ON public.tags
    FOR INSERT TO authenticated
    WITH CHECK (
        tag_type <> 'embedded'
        AND (SELECT public.owns_profile(tags.owner_profile_id))
        AND (tags.dest_profile_id IS NULL OR (SELECT public.owns_profile(tags.dest_profile_id)))
        AND (tags.dest_product_id IS NULL OR EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = tags.dest_product_id AND (SELECT public.owns_profile(p.business_profile_id))
        ))
        AND (tags.dest_project_id IS NULL OR EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = tags.dest_project_id AND (SELECT public.owns_profile(p.owner_profile_id))
        ))
        AND (tags.dest_post_id IS NULL OR EXISTS (
            SELECT 1 FROM public.posts p
            WHERE p.id = tags.dest_post_id AND (SELECT public.owns_profile(p.user_id))
        ))
    );

DROP POLICY "Users can update own tags" ON public.tags;
CREATE POLICY "Users can update own tags" ON public.tags
    FOR UPDATE TO authenticated
    USING (tag_type <> 'embedded' AND (SELECT public.owns_profile(tags.owner_profile_id)))
    WITH CHECK (
        tag_type <> 'embedded'
        AND (SELECT public.owns_profile(tags.owner_profile_id))
        AND (tags.dest_profile_id IS NULL OR (SELECT public.owns_profile(tags.dest_profile_id)))
        AND (tags.dest_product_id IS NULL OR EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = tags.dest_product_id AND (SELECT public.owns_profile(p.business_profile_id))
        ))
        AND (tags.dest_project_id IS NULL OR EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = tags.dest_project_id AND (SELECT public.owns_profile(p.owner_profile_id))
        ))
        AND (tags.dest_post_id IS NULL OR EXISTS (
            SELECT 1 FROM public.posts p
            WHERE p.id = tags.dest_post_id AND (SELECT public.owns_profile(p.user_id))
        ))
    );

-- ─── Embedded: any post the author can see ────────────────────────────
--
-- The posts subquery reads under the author's own RLS, so a post they can't
-- see — a private account they don't follow, or one across a block either
-- way — is one they can't point at. Viewers who can't see it never see the
-- tag either: the post read drops a tag whose destination it can't read.

DROP POLICY "Authors can embed tags in own posts" ON public.tags;
CREATE POLICY "Authors can embed tags in own posts" ON public.tags
    FOR INSERT TO authenticated
    WITH CHECK (
        tag_type = 'embedded'
        AND (SELECT public.owns_profile(tags.owner_profile_id))
        AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = tags.host_post_id AND p.user_id = tags.owner_profile_id)
        AND (tags.dest_project_id IS NULL OR EXISTS (
            SELECT 1 FROM public.projects p WHERE p.id = tags.dest_project_id AND p.is_public
        ))
        AND (tags.dest_post_id IS NULL OR (
            tags.dest_post_id <> tags.host_post_id
            AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = tags.dest_post_id)
        ))
        AND NOT public.hidden_by_block(
            public.embedded_tag_destination_owner(tags.dest_profile_id, tags.dest_product_id, tags.dest_project_id)
        )
    );

DROP POLICY "Authors can update tags in own posts" ON public.tags;
CREATE POLICY "Authors can update tags in own posts" ON public.tags
    FOR UPDATE TO authenticated
    USING (tag_type = 'embedded' AND (SELECT public.owns_profile(tags.owner_profile_id)))
    WITH CHECK (
        tag_type = 'embedded'
        AND (SELECT public.owns_profile(tags.owner_profile_id))
        AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = tags.host_post_id AND p.user_id = tags.owner_profile_id)
        AND (tags.dest_project_id IS NULL OR EXISTS (
            SELECT 1 FROM public.projects p WHERE p.id = tags.dest_project_id AND p.is_public
        ))
        AND (tags.dest_post_id IS NULL OR (
            tags.dest_post_id <> tags.host_post_id
            AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = tags.dest_post_id)
        ))
        AND NOT public.hidden_by_block(
            public.embedded_tag_destination_owner(tags.dest_profile_id, tags.dest_product_id, tags.dest_project_id)
        )
    );

-- A post's author can take a tag pointing at it off someone else's photo.
DROP POLICY "Tagged destinations can remove embedded tags" ON public.tags;
CREATE POLICY "Tagged destinations can remove embedded tags" ON public.tags
    FOR DELETE TO authenticated
    USING (
        tag_type = 'embedded'
        AND (
            (tags.dest_profile_id IS NOT NULL AND (SELECT public.owns_profile(tags.dest_profile_id)))
            OR (tags.dest_product_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.products p
                WHERE p.id = tags.dest_product_id AND (SELECT public.owns_profile(p.business_profile_id))
            ))
            OR (tags.dest_project_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.projects p
                WHERE p.id = tags.dest_project_id AND (SELECT public.owns_profile(p.owner_profile_id))
            ))
            OR (tags.dest_post_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.posts p
                WHERE p.id = tags.dest_post_id AND (SELECT public.owns_profile(p.user_id))
            ))
        )
    );

-- ─── Resolution ───────────────────────────────────────────────────────

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
    dest_post_username TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    CASE WHEN t.active THEN t.id END,
    t.active,
    CASE WHEN t.active THEN t.dest_profile_id END,
    CASE WHEN t.active THEN p.username END,
    CASE WHEN t.active THEN t.dest_product_id END,
    CASE WHEN t.active THEN t.dest_project_id END,
    -- Returned for any post, as for a private project: the post screen
    -- decides who sees it. The handle is the tag owner's own, since a
    -- Physical or Digital Tag only points at its owner's posts.
    CASE WHEN t.active THEN t.dest_post_id END,
    CASE WHEN t.active THEN author.username END
  FROM public.tags t
  LEFT JOIN public.profiles p ON p.id = t.dest_profile_id
  LEFT JOIN public.posts po ON po.id = t.dest_post_id
  LEFT JOIN public.profiles author ON author.id = po.user_id
  WHERE t.short_code = p_short_code
    AND t.tag_type <> 'embedded';
$$;

-- A stranger with no account resolves a scanned tag (ONE-30).
REVOKE ALL ON FUNCTION public.resolve_tag(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_tag(TEXT) TO anon, authenticated;

-- ─── Scan history ─────────────────────────────────────────────────────
--
-- As before (20260926100300), with a post listed by its author. Its text
-- never appears: the history can be public while the post is not.

CREATE OR REPLACE FUNCTION public.scan_history(p_profile_id UUID)
RETURNS TABLE (
    dest_kind TEXT,
    dest_id UUID,
    dest_name TEXT,
    dest_username TEXT,
    scan_count BIGINT,
    last_scanned_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    h.dest_kind,
    h.dest_id,
    h.dest_name,
    h.dest_username,
    count(*),
    max(h.scanned_at)
  FROM (
    SELECT
      s.scanned_at,
      CASE
        WHEN t.dest_profile_id IS NOT NULL THEN 'profile'
        WHEN t.dest_product_id IS NOT NULL THEN 'product'
        WHEN t.dest_project_id IS NOT NULL THEN 'project'
        ELSE 'post'
      END AS dest_kind,
      coalesce(t.dest_profile_id, t.dest_product_id, t.dest_project_id, t.dest_post_id) AS dest_id,
      CASE
        WHEN t.dest_profile_id IS NOT NULL THEN coalesce(nullif(pr.full_name, ''), pr.username)
        WHEN t.dest_product_id IS NOT NULL THEN pd.name
        WHEN t.dest_project_id IS NOT NULL THEN pj.name
        ELSE 'Post by @' || author.username
      END AS dest_name,
      coalesce(pr.username, author.username) AS dest_username
    FROM public.scans s
    JOIN public.tags t ON t.id = s.tag_id
    LEFT JOIN public.profiles pr ON pr.id = t.dest_profile_id
    LEFT JOIN public.products pd ON pd.id = t.dest_product_id
    LEFT JOIN public.projects pj ON pj.id = t.dest_project_id
    LEFT JOIN public.posts po ON po.id = t.dest_post_id
    LEFT JOIN public.profiles author ON author.id = po.user_id
    WHERE s.scanner_profile_id = p_profile_id
      -- Taps on tags in posts are scans for the tag's owner's counts, not
      -- places someone has been.
      AND t.tag_type <> 'embedded'
      AND (
        public.owns_profile(p_profile_id)
        OR EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = p_profile_id AND me.scan_history_public)
      )
      AND (
        t.dest_project_id IS NULL
        OR pj.is_public
        OR public.owns_profile(pj.owner_profile_id)
        OR public.is_project_contributor(pj.id)
      )
  ) h
  GROUP BY h.dest_kind, h.dest_id, h.dest_name, h.dest_username
  ORDER BY max(h.scanned_at) DESC;
$$;
