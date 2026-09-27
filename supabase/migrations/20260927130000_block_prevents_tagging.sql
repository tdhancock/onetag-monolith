-- A block prevents an embedded tag (ONE-93, decided 2026-09-27).
--
-- ONE-44 lets a post's author tag any profile, any product, or any public
-- project. If either account has blocked the other, being tagged by them is
-- exactly the contact the block was meant to end, so the tag is refused —
-- in either direction, as a block is everywhere else (ONE-54).
--
-- "The other account" is the destination's owner: the tagged profile itself,
-- the business listing the product, or the project's owner.
-- hidden_by_block() (ONE-48) answers for both directions from the caller's
-- side, and the caller is the author: RLS requires they own the tag.
--
-- A block made after a tag exists does not remove the tag; the tagged side
-- can remove it themselves ("Tagged destinations can remove embedded tags").
--
-- The two policies are ONE-44's, re-created with the block check added.

CREATE OR REPLACE FUNCTION public.embedded_tag_destination_owner(
    p_dest_profile_id UUID,
    p_dest_product_id UUID,
    p_dest_project_id UUID
)
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    p_dest_profile_id,
    (SELECT pd.business_profile_id FROM public.products pd WHERE pd.id = p_dest_product_id),
    (SELECT pj.owner_profile_id FROM public.projects pj WHERE pj.id = p_dest_project_id)
  );
$$;

-- Called from the policies below, so signed-in callers need it; nobody
-- signed out writes tags. Revoked from anon by name (ONE-85).
REVOKE ALL ON FUNCTION public.embedded_tag_destination_owner(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.embedded_tag_destination_owner(UUID, UUID, UUID) TO authenticated;

DROP POLICY "Authors can embed tags in own posts" ON public.tags;
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
        AND NOT public.hidden_by_block(
            public.embedded_tag_destination_owner(tags.dest_profile_id, tags.dest_product_id, tags.dest_project_id)
        )
    );

DROP POLICY "Authors can update tags in own posts" ON public.tags;
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
        AND NOT public.hidden_by_block(
            public.embedded_tag_destination_owner(tags.dest_profile_id, tags.dest_product_id, tags.dest_project_id)
        )
    );
