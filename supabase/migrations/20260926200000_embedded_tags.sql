-- Embedded Tags and their positions (ONE-44).
--
-- An Embedded Tag is a Tag pinned to a point on a post's image. It is created
-- in the composer, tapped on screen and never scanned, and a tap is recorded
-- as an ordinary Scan: tag_accepts_scans() already takes any active tag, so
-- there is no new table.
--
-- Three things set it apart from Physical and Digital Tags:
--
--   * It sits in a host post, at a position given as a percentage of the
--     image's width and height, so it lands on the same point of the image at
--     any render size.
--   * It is as visible as its post. Physical and Digital Tags stay readable by
--     their owner alone (ONE-82); an embedded tag is readable by anyone who can
--     read the post it sits in, and so it may carry no note.
--   * It may point at anyone's destination. Tagging another business's product
--     in your photo is the point, so the own-destinations rule on insert and
--     update applies to Physical and Digital Tags only. In exchange, the owner
--     of a tagged destination may remove the tag, the way a Contributor can
--     withdraw from a Project.
--
-- Additive for the client: nothing reads these columns until the post
-- rendering (ONE-45) and the composer (ONE-46).

-- ─── Columns ──────────────────────────────────────────────────────────

ALTER TABLE public.tags
    -- The post the tag is embedded in, not a destination: a post is not one
    -- of the four kinds (ONE-83). Deleting the post removes its tags.
    ADD COLUMN host_post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
    ADD COLUMN tag_x_pct NUMERIC(5,2),
    ADD COLUMN tag_y_pct NUMERIC(5,2);

-- A post and a position for an embedded tag, and neither for any other: a
-- physical tag with coordinates is meaningless, and an embedded tag without
-- them cannot be rendered. Every existing row is physical or digital with all
-- three null, so every existing row satisfies it.
ALTER TABLE public.tags ADD CONSTRAINT tags_embedded_position CHECK (
    CASE WHEN tag_type = 'embedded'
        THEN num_nonnulls(host_post_id, tag_x_pct, tag_y_pct) = 3
        ELSE num_nonnulls(host_post_id, tag_x_pct, tag_y_pct) = 0
    END
);

ALTER TABLE public.tags ADD CONSTRAINT tags_x_pct_range CHECK (tag_x_pct BETWEEN 0 AND 100);
ALTER TABLE public.tags ADD CONSTRAINT tags_y_pct_range CHECK (tag_y_pct BETWEEN 0 AND 100);

-- Neither QR nor NFC, and no note: an embedded tag is read by everyone who
-- can see its post, and ONE-82 promises a note stays with the tag's owner.
ALTER TABLE public.tags ADD CONSTRAINT tags_embedded_no_format_or_note CHECK (
    tag_type <> 'embedded' OR (format IS NULL AND note IS NULL)
);

-- Every post render asks for its embedded tags, and deleting a post cascades
-- through this key.
CREATE INDEX tags_host_post_id ON public.tags (host_post_id) WHERE host_post_id IS NOT NULL;

-- ─── RLS: Physical and Digital Tags keep the own-destinations rule ────
--
-- As ONE-38 left them, now limited to tag_type <> 'embedded'. Embedded tags
-- get policies of their own below; permissive policies OR together, so each
-- kind of tag is governed by exactly one insert and one update policy.

DROP POLICY "Users can create tags to own destinations" ON public.tags;
CREATE POLICY "Users can create tags to own destinations" ON public.tags
    FOR INSERT TO authenticated
    WITH CHECK (
        tags.tag_type <> 'embedded'
        AND (SELECT public.owns_profile(owner_profile_id))
        AND (tags.dest_profile_id IS NULL OR (SELECT public.owns_profile(tags.dest_profile_id)))
        AND (tags.dest_product_id IS NULL OR EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = tags.dest_product_id AND (SELECT public.owns_profile(p.business_profile_id))
        ))
        AND (tags.dest_project_id IS NULL OR EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = tags.dest_project_id AND (SELECT public.owns_profile(p.owner_profile_id))
        ))
    );

DROP POLICY "Users can update own tags" ON public.tags;
CREATE POLICY "Users can update own tags" ON public.tags
    FOR UPDATE TO authenticated
    USING (tags.tag_type <> 'embedded' AND (SELECT public.owns_profile(owner_profile_id)))
    WITH CHECK (
        tags.tag_type <> 'embedded'
        AND (SELECT public.owns_profile(owner_profile_id))
        AND (tags.dest_profile_id IS NULL OR (SELECT public.owns_profile(tags.dest_profile_id)))
        AND (tags.dest_product_id IS NULL OR EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = tags.dest_product_id AND (SELECT public.owns_profile(p.business_profile_id))
        ))
        AND (tags.dest_project_id IS NULL OR EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = tags.dest_project_id AND (SELECT public.owns_profile(p.owner_profile_id))
        ))
    );

-- ─── RLS: Embedded Tags ───────────────────────────────────────────────

-- As visible as the post it sits in. The EXISTS runs under the caller's own
-- RLS on posts, so a tag on a private profile's post is hidden from exactly
-- the people the post is hidden from, and never leaks that the post exists.
-- Posts are readable only when signed in, so this is too.
CREATE POLICY "Embedded tags are viewable with their post" ON public.tags
    FOR SELECT TO authenticated
    USING (
        tags.tag_type = 'embedded'
        AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = tags.host_post_id)
    );

-- Created by the host post's author, as the profile that wrote it, pointing
-- at any profile, any product, or any public project (decided 2026-09-25).
-- A private project is not somewhere a stranger's post can send people.
CREATE POLICY "Authors can embed tags in own posts" ON public.tags
    FOR INSERT TO authenticated
    WITH CHECK (
        tags.tag_type = 'embedded'
        AND (SELECT public.owns_profile(owner_profile_id))
        AND EXISTS (
            SELECT 1 FROM public.posts p
            WHERE p.id = tags.host_post_id AND p.user_id = tags.owner_profile_id
        )
        AND (tags.dest_project_id IS NULL OR EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = tags.dest_project_id AND p.is_public
        ))
    );

-- The same rules on update — moving a tag, pausing it. Its destination,
-- type and owner are frozen by protect_tag_identity (ONE-86) regardless.
CREATE POLICY "Authors can update tags in own posts" ON public.tags
    FOR UPDATE TO authenticated
    USING (tags.tag_type = 'embedded' AND (SELECT public.owns_profile(owner_profile_id)))
    WITH CHECK (
        tags.tag_type = 'embedded'
        AND (SELECT public.owns_profile(owner_profile_id))
        AND EXISTS (
            SELECT 1 FROM public.posts p
            WHERE p.id = tags.host_post_id AND p.user_id = tags.owner_profile_id
        )
        AND (tags.dest_project_id IS NULL OR EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = tags.dest_project_id AND p.is_public
        ))
    );

-- Being tagged is a public claim about you, so the destination's owner may
-- take it down: the tagged profile, the product's business, or the project's
-- owner. The tag's own author keeps "Users can delete own tags".
CREATE POLICY "Tagged destinations can remove embedded tags" ON public.tags
    FOR DELETE TO authenticated
    USING (
        tags.tag_type = 'embedded'
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
        )
    );

-- ─── resolve_tag refuses embedded tags ────────────────────────────────
--
-- An embedded tag is tapped from its post, never opened by code, so
-- /t/<code> for one reads as not-found. As ONE-38 left it, plus the tag_type
-- filter; the result columns are unchanged, so CREATE OR REPLACE keeps its
-- grants, restated here all the same.

CREATE OR REPLACE FUNCTION public.resolve_tag(p_short_code TEXT)
RETURNS TABLE (
    tag_id UUID,
    active BOOLEAN,
    dest_profile_id UUID,
    dest_profile_username TEXT,
    dest_product_id UUID,
    dest_project_id UUID
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
    CASE WHEN t.active THEN t.dest_project_id END
  FROM public.tags t
  LEFT JOIN public.profiles p ON p.id = t.dest_profile_id
  WHERE t.short_code = p_short_code
    AND t.tag_type <> 'embedded';
$$;

REVOKE ALL ON FUNCTION public.resolve_tag(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_tag(TEXT) TO anon, authenticated;
