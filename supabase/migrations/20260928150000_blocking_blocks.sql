-- Blocking blocks (ONE-108).
--
-- The block sheet promises: "They won't be able to find your profile, posts,
-- or story, and they won't be notified." Search, Explore and tags honoured
-- that (hidden_by_block), and comments and messages refused someone the
-- author or receiver had blocked. Nothing else did, and nothing ran on a
-- block: a blocked follower kept following, kept the blocker's posts in the
-- feed and OneSnaps in the reel, and could follow again, like and repost.
--
-- Decided 2026-09-27: a full block, both ways. Blocks stay account-level: a
-- person blocks a person, so every profile of either account is covered.
--
--   - Blocking removes follows and pending follow requests between the two,
--     both ways.
--   - Neither side can follow, like, repost, comment on, like a comment of,
--     like a OneSnap of, or message the other.
--   - Each side's posts and OneSnaps are hidden from the other.
--   - Suggestions leave both out.
--
-- Notifications across a block are the notification triggers' job (ONE-107).
-- Unblocking restores nothing: either may follow again.

-- ─── The profiles hidden from the caller, once per query ──────────────
--
-- Every profile of an account that blocked the caller, or that the caller
-- blocked. A set, not a per-row function call: a policy reads it as a hashed
-- subplan, evaluated once per statement (ONE-105). SECURITY DEFINER because
-- the caller may read only their own blocks.

CREATE OR REPLACE FUNCTION public.hidden_profile_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id
  FROM public.profiles p
  JOIN public.blocks b
    ON (b.blocker_id = p.user_id AND b.blocked_id = (SELECT auth.uid()))
    OR (b.blocked_id = p.user_id AND b.blocker_id = (SELECT auth.uid()));
$$;

-- Whether a post's, a OneSnap's or a comment's author is hidden from the
-- caller. For the insert policies: SECURITY DEFINER, because once content is
-- hidden a subquery run as the caller finds no row at all, and "no row" must
-- never read as "no block".

CREATE OR REPLACE FUNCTION public.post_hidden_by_block(p_post_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((SELECT public.hidden_by_block(p.user_id) FROM public.posts p WHERE p.id = p_post_id), false);
$$;

CREATE OR REPLACE FUNCTION public.story_hidden_by_block(p_story_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((SELECT public.hidden_by_block(s.user_id) FROM public.stories s WHERE s.id = p_story_id), false);
$$;

CREATE OR REPLACE FUNCTION public.comment_hidden_by_block(p_comment_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((SELECT public.hidden_by_block(c.user_id) FROM public.comments c WHERE c.id = p_comment_id), false);
$$;

REVOKE ALL ON FUNCTION public.hidden_profile_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_hidden_by_block(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.story_hidden_by_block(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.comment_hidden_by_block(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hidden_profile_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_hidden_by_block(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.story_hidden_by_block(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comment_hidden_by_block(UUID) TO authenticated;

-- ─── A block removes follows and pending requests, both ways ──────────

CREATE OR REPLACE FUNCTION public.sever_on_block()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.follows f
  USING public.profiles a, public.profiles b
  WHERE a.user_id = NEW.blocker_id
    AND b.user_id = NEW.blocked_id
    AND ((f.follower_id = a.id AND f.followed_id = b.id) OR (f.follower_id = b.id AND f.followed_id = a.id));

  DELETE FROM public.follow_requests r
  USING public.profiles a, public.profiles b
  WHERE a.user_id = NEW.blocker_id
    AND b.user_id = NEW.blocked_id
    AND ((r.requester_profile_id = a.id AND r.target_profile_id = b.id)
      OR (r.requester_profile_id = b.id AND r.target_profile_id = a.id));

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sever_on_block() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER blocks_sever
    AFTER INSERT ON public.blocks
    FOR EACH ROW EXECUTE FUNCTION public.sever_on_block();

-- ─── Posts and OneSnaps are hidden across a block ─────────────────────
--
-- The owner and admins see everything, as before. For anyone else, a hidden
-- author comes first and closes every other way in.

DROP POLICY "Posts visible unless author is private" ON public.posts;
CREATE POLICY "Posts visible unless author is private" ON public.posts
    FOR SELECT TO authenticated
    USING (
        (SELECT public.owns_profile(user_id))
        OR (SELECT public.is_admin())
        OR (
            user_id NOT IN (SELECT public.hidden_profile_ids())
            AND (
                NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = posts.user_id AND p.is_private)
                OR EXISTS (
                    SELECT 1 FROM public.follows f
                    WHERE f.followed_id = posts.user_id
                      AND (SELECT public.owns_profile(f.follower_id))
                )
            )
        )
    );

DROP POLICY "Stories visible to owner and followers" ON public.stories;
CREATE POLICY "Stories visible to owner and followers" ON public.stories
    FOR SELECT TO authenticated
    USING (
        (SELECT public.owns_profile(user_id))
        OR (
            user_id NOT IN (SELECT public.hidden_profile_ids())
            AND EXISTS (
                SELECT 1 FROM public.follows f
                WHERE f.followed_id = stories.user_id
                  AND (SELECT public.owns_profile(f.follower_id))
            )
        )
    );

-- ─── Nothing reaches across a block ───────────────────────────────────

DROP POLICY "Users can follow as themselves" ON public.follows;
CREATE POLICY "Users can follow as themselves" ON public.follows
    FOR INSERT TO authenticated WITH CHECK (
        (SELECT public.owns_profile(follower_id))
        AND NOT public.hidden_by_block(followed_id)
        AND (
            NOT EXISTS (
                SELECT 1 FROM public.profiles p
                WHERE p.id = followed_id AND p.is_private
            )
            OR (SELECT public.owns_profile(followed_id))
        )
    );

DROP POLICY "Users can like as themselves" ON public.likes;
CREATE POLICY "Users can like as themselves" ON public.likes
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.owns_profile(user_id)) AND NOT public.post_hidden_by_block(post_id));

DROP POLICY "Users can repost as themselves" ON public.reposts;
CREATE POLICY "Users can repost as themselves" ON public.reposts
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.owns_profile(user_id)) AND NOT public.post_hidden_by_block(post_id));

-- Both ways now: it used to refuse only someone the post's author blocked.
DROP POLICY "Users can comment as themselves" ON public.comments;
CREATE POLICY "Users can comment as themselves" ON public.comments
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.owns_profile(user_id)) AND NOT public.post_hidden_by_block(post_id));

DROP POLICY "Users can like comments as themselves" ON public.comment_likes;
CREATE POLICY "Users can like comments as themselves" ON public.comment_likes
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.owns_profile(user_id)) AND NOT public.comment_hidden_by_block(comment_id));

DROP POLICY "Users can like stories as themselves" ON public.story_likes;
CREATE POLICY "Users can like stories as themselves" ON public.story_likes
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.owns_profile(user_id)) AND NOT public.story_hidden_by_block(story_id));

-- Both ways now: it used to refuse only someone the receiver blocked.
DROP POLICY "Users can send messages as themselves" ON public.messages;
CREATE POLICY "Users can send messages as themselves" ON public.messages
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.owns_profile(sender_id)) AND NOT public.hidden_by_block(receiver_id));

-- ─── Suggestions leave both out ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.suggested_profiles(p_viewer UUID, p_limit INTEGER DEFAULT 5)
RETURNS SETOF public.profiles
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT p.* FROM public.profiles p
  WHERE p.id <> p_viewer
    AND p.id NOT IN (SELECT f.followed_id FROM public.follows f WHERE f.follower_id = p_viewer)
    AND p.id NOT IN (SELECT public.hidden_profile_ids())
  ORDER BY p.created_at DESC
  LIMIT least(greatest(coalesce(p_limit, 5), 1), 50);
$$;
