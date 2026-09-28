-- Nobody engages with what they can't see (ONE-115).
--
-- ONE-109 made a private account's comments and likes as private as its
-- posts to read. Writing them was never checked: every engagement insert
-- asked only whether the writer owned the profile and, since ONE-108, that
-- no block stood between them. A stranger with a private post's id could
-- like, comment on, repost and save it, like a comment on it, and like and
-- view the account's OneSnaps. Each like, repost and comment notified the
-- owner, and a comment pushed to their phone.
--
-- Now each also requires what it engages with to be visible to the writer.
-- The EXISTS reads run under the writer's own RLS, so the target's read
-- policy decides — privacy, blocks and ownership — exactly as for reading.
-- The block checks stay: they're the rule ONE-108 pinned, and they hold even
-- for an admin, who can read everything.
--
-- Two updates could do the same by moving a row: a comment's author could
-- change its post, and a OneSnap view its OneSnap. Each now checks where the
-- row ends up the same way.

-- ─── Posts ────────────────────────────────────────────────────────────

DROP POLICY "Users can like as themselves" ON public.likes;
CREATE POLICY "Users can like as themselves" ON public.likes
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT public.owns_profile(user_id))
        AND NOT public.post_hidden_by_block(post_id)
        AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = likes.post_id)
    );

DROP POLICY "Users can repost as themselves" ON public.reposts;
CREATE POLICY "Users can repost as themselves" ON public.reposts
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT public.owns_profile(user_id))
        AND NOT public.post_hidden_by_block(post_id)
        AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = reposts.post_id)
    );

DROP POLICY "Users can comment as themselves" ON public.comments;
CREATE POLICY "Users can comment as themselves" ON public.comments
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT public.owns_profile(user_id))
        AND NOT public.post_hidden_by_block(post_id)
        AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = comments.post_id)
    );

DROP POLICY "Users can update own comments" ON public.comments;
CREATE POLICY "Users can update own comments" ON public.comments
    FOR UPDATE TO authenticated
    USING ((SELECT public.owns_profile(user_id)))
    WITH CHECK (
        (SELECT public.owns_profile(user_id))
        AND NOT public.post_hidden_by_block(post_id)
        AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = comments.post_id)
    );

DROP POLICY "Users can like comments as themselves" ON public.comment_likes;
CREATE POLICY "Users can like comments as themselves" ON public.comment_likes
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT public.owns_profile(user_id))
        AND NOT public.comment_hidden_by_block(comment_id)
        AND EXISTS (SELECT 1 FROM public.comments c WHERE c.id = comment_likes.comment_id)
    );

-- ─── OneSnaps ─────────────────────────────────────────────────────────

DROP POLICY "Users can like stories as themselves" ON public.story_likes;
CREATE POLICY "Users can like stories as themselves" ON public.story_likes
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT public.owns_profile(user_id))
        AND NOT public.story_hidden_by_block(story_id)
        AND EXISTS (SELECT 1 FROM public.stories s WHERE s.id = story_likes.story_id)
    );

DROP POLICY "Users can record own story views" ON public.story_views;
CREATE POLICY "Users can record own story views" ON public.story_views
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT public.owns_profile(user_id))
        AND EXISTS (SELECT 1 FROM public.stories s WHERE s.id = story_views.story_id)
    );

DROP POLICY "Users can update own story views" ON public.story_views;
CREATE POLICY "Users can update own story views" ON public.story_views
    FOR UPDATE TO authenticated
    USING ((SELECT public.owns_profile(user_id)))
    WITH CHECK (
        (SELECT public.owns_profile(user_id))
        AND EXISTS (SELECT 1 FROM public.stories s WHERE s.id = story_views.story_id)
    );

-- ─── Saves ────────────────────────────────────────────────────────────

DROP POLICY "Users can save as themselves" ON public.saves;
CREATE POLICY "Users can save as themselves" ON public.saves
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT public.owns_profile(profile_id))
        AND (saved_post_id IS NULL
             OR EXISTS (SELECT 1 FROM public.posts p WHERE p.id = saves.saved_post_id))
        AND (saved_product_id IS NULL
             OR EXISTS (SELECT 1 FROM public.products p WHERE p.id = saves.saved_product_id))
        AND (saved_project_id IS NULL
             OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = saves.saved_project_id))
        AND (saved_profile_id IS NULL
             OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = saves.saved_profile_id))
    );
