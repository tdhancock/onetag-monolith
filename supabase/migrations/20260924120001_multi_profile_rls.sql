-- Multi-profile RLS: ownership moves from "this column is my auth id" to
-- "this column is a profile my account owns" (ONE-21).
--
-- Applied in the same deploy as 20260924120000_multi_profile.sql. Every
-- policy that compared a profile-owned column to auth.uid() is rewritten
-- through `public.owns_profile()`. Three kinds of policy are deliberately not:
--
--   * profiles' own policies key on `user_id` directly. A policy on profiles
--     must not call a function that reads profiles.
--   * push_tokens keys on the account: a device registers per account, not
--     per profile. Its policies already compare to auth.uid() and stay.
--   * blocks is account-level — a person blocks a person, which is how ONE-54
--     read it and why it references auth.users. Its policies stay on auth.uid();
--     `is_blocked_by` is what changes, below.
--
-- Storage policies stay keyed on auth.uid() too: upload paths are built from
-- the auth user id, never a profile id (see 20260506000002).

-- ═══════════════════════════════════════
-- The ownership helper
-- ═══════════════════════════════════════
--
-- True when the signed-in account owns the profile. SECURITY DEFINER so it
-- reads profiles without recursing into profiles' own RLS; STABLE so Postgres
-- may reuse the result within a statement. It resolves ownership from
-- auth.uid() itself, so a caller cannot use it to learn about anyone else.
CREATE OR REPLACE FUNCTION public.owns_profile(p_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_profile_id AND user_id = (SELECT auth.uid())
  );
$$;

-- Policies run as the caller, so the caller's role needs EXECUTE. anon is
-- included for policies that will admit anonymous readers (tags, ONE-27);
-- with no auth.uid() it can only ever answer false.
REVOKE ALL ON FUNCTION public.owns_profile(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owns_profile(UUID) TO authenticated, anon;

-- ═══════════════════════════════════════
-- Functions that compared a profile id to auth.uid()
-- ═══════════════════════════════════════

-- An account is an admin when any profile it owns carries the flag. The flag
-- is set per row by the database owner (protect_profile_verified refuses
-- anyone else), so it is still an account-level decision.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = (SELECT auth.uid()) AND is_admin
  );
$$;

-- Has the account behind this profile blocked the caller's account?
--
-- The policies pass a profile id — messages.receiver_id, posts.user_id — and
-- blocks holds auth user ids. Before this migration the two were equal and
-- the comparison was direct; now the target profile is resolved to its
-- owning account first. Without that, every block would silently stop being
-- enforced the first time a profile id differed from its account id: the
-- insert policies would not error, they would just stop matching.
CREATE OR REPLACE FUNCTION public.is_blocked_by(target UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.blocks b ON b.blocker_id = p.user_id
    WHERE p.id = target AND b.blocked_id = (SELECT auth.uid())
  );
$$;

-- Username login looks the email up through the profile's account.
CREATE OR REPLACE FUNCTION public.get_email_by_username(p_username TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.email::text
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
  WHERE lower(p.username) = lower(p_username)
  LIMIT 1;
$$;

-- Deleting a conversation: the caller must own one of its two profiles.
CREATE OR REPLACE FUNCTION public.delete_conversation(user1 UUID, user2 UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR NOT (public.owns_profile(user1) OR public.owns_profile(user2)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.messages
  WHERE (sender_id = user1 AND receiver_id = user2)
     OR (sender_id = user2 AND receiver_id = user1);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_chat_history(user_id_1 UUID, user_id_2 UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR NOT (public.owns_profile(user_id_1) OR public.owns_profile(user_id_2)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.messages
  WHERE (sender_id = user_id_1 AND receiver_id = user_id_2)
     OR (sender_id = user_id_2 AND receiver_id = user_id_1);
END;
$$;

-- ═══════════════════════════════════════
-- profiles — keyed on user_id directly
-- ═══════════════════════════════════════

DROP POLICY "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
    FOR INSERT TO authenticated
    WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

-- Unchanged: "Profiles are viewable by everyone", "Admins can update profiles".

-- ═══════════════════════════════════════
-- posts
-- ═══════════════════════════════════════

DROP POLICY "Users can create own posts" ON public.posts;
CREATE POLICY "Users can create own posts" ON public.posts
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.owns_profile(user_id)));

DROP POLICY "Users can update own posts" ON public.posts;
CREATE POLICY "Users can update own posts" ON public.posts
    FOR UPDATE TO authenticated
    USING ((SELECT public.owns_profile(user_id)))
    WITH CHECK ((SELECT public.owns_profile(user_id)));

DROP POLICY "Users can delete own posts" ON public.posts;
CREATE POLICY "Users can delete own posts" ON public.posts
    FOR DELETE TO authenticated
    USING ((SELECT public.owns_profile(user_id)));

-- A private profile's posts: its owner, admins, and followers — where
-- "follower" means any profile the caller's account owns.
DROP POLICY "Posts visible unless author is private" ON public.posts;
CREATE POLICY "Posts visible unless author is private" ON public.posts
    FOR SELECT TO authenticated
    USING (
        (SELECT public.owns_profile(user_id))
        OR public.is_admin()
        OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = posts.user_id AND p.is_private)
        OR EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.followed_id = posts.user_id
              AND (SELECT public.owns_profile(f.follower_id))
        )
    );

-- Unchanged: "Admins can delete any post".

-- ═══════════════════════════════════════
-- Join tables: likes, reposts, saved_posts, comment_likes, story_likes
-- ═══════════════════════════════════════

DROP POLICY "Users can like as themselves" ON public.likes;
CREATE POLICY "Users can like as themselves" ON public.likes
    FOR INSERT TO authenticated WITH CHECK ((SELECT public.owns_profile(user_id)));
DROP POLICY "Users can remove own likes" ON public.likes;
CREATE POLICY "Users can remove own likes" ON public.likes
    FOR DELETE TO authenticated USING ((SELECT public.owns_profile(user_id)));

DROP POLICY "Users can repost as themselves" ON public.reposts;
CREATE POLICY "Users can repost as themselves" ON public.reposts
    FOR INSERT TO authenticated WITH CHECK ((SELECT public.owns_profile(user_id)));
DROP POLICY "Users can remove own reposts" ON public.reposts;
CREATE POLICY "Users can remove own reposts" ON public.reposts
    FOR DELETE TO authenticated USING ((SELECT public.owns_profile(user_id)));

DROP POLICY "Users can view own saved posts" ON public.saved_posts;
CREATE POLICY "Users can view own saved posts" ON public.saved_posts
    FOR SELECT TO authenticated USING ((SELECT public.owns_profile(user_id)));
DROP POLICY "Users can save posts as themselves" ON public.saved_posts;
CREATE POLICY "Users can save posts as themselves" ON public.saved_posts
    FOR INSERT TO authenticated WITH CHECK ((SELECT public.owns_profile(user_id)));
DROP POLICY "Users can unsave own posts" ON public.saved_posts;
CREATE POLICY "Users can unsave own posts" ON public.saved_posts
    FOR DELETE TO authenticated USING ((SELECT public.owns_profile(user_id)));

DROP POLICY "Users can like comments as themselves" ON public.comment_likes;
CREATE POLICY "Users can like comments as themselves" ON public.comment_likes
    FOR INSERT TO authenticated WITH CHECK ((SELECT public.owns_profile(user_id)));
DROP POLICY "Users can remove own comment likes" ON public.comment_likes;
CREATE POLICY "Users can remove own comment likes" ON public.comment_likes
    FOR DELETE TO authenticated USING ((SELECT public.owns_profile(user_id)));

DROP POLICY "Users can like stories as themselves" ON public.story_likes;
CREATE POLICY "Users can like stories as themselves" ON public.story_likes
    FOR INSERT TO authenticated WITH CHECK ((SELECT public.owns_profile(user_id)));
DROP POLICY "Users can remove own story likes" ON public.story_likes;
CREATE POLICY "Users can remove own story likes" ON public.story_likes
    FOR DELETE TO authenticated USING ((SELECT public.owns_profile(user_id)));

-- ═══════════════════════════════════════
-- comments
-- ═══════════════════════════════════════

DROP POLICY "Users can comment as themselves" ON public.comments;
CREATE POLICY "Users can comment as themselves" ON public.comments
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT public.owns_profile(user_id))
        AND NOT EXISTS (
            SELECT 1 FROM public.posts p
            WHERE p.id = comments.post_id AND public.is_blocked_by(p.user_id)
        )
    );

DROP POLICY "Users can update own comments" ON public.comments;
CREATE POLICY "Users can update own comments" ON public.comments
    FOR UPDATE TO authenticated
    USING ((SELECT public.owns_profile(user_id)))
    WITH CHECK ((SELECT public.owns_profile(user_id)));

DROP POLICY "Users can delete own comments" ON public.comments;
CREATE POLICY "Users can delete own comments" ON public.comments
    FOR DELETE TO authenticated USING ((SELECT public.owns_profile(user_id)));

-- ═══════════════════════════════════════
-- follows
-- ═══════════════════════════════════════

DROP POLICY "Users can follow as themselves" ON public.follows;
CREATE POLICY "Users can follow as themselves" ON public.follows
    FOR INSERT TO authenticated WITH CHECK ((SELECT public.owns_profile(follower_id)));
DROP POLICY "Users can unfollow" ON public.follows;
CREATE POLICY "Users can unfollow" ON public.follows
    FOR DELETE TO authenticated USING ((SELECT public.owns_profile(follower_id)));

-- ═══════════════════════════════════════
-- stories and story_views
-- ═══════════════════════════════════════

DROP POLICY "Users can create own stories" ON public.stories;
CREATE POLICY "Users can create own stories" ON public.stories
    FOR INSERT TO authenticated WITH CHECK ((SELECT public.owns_profile(user_id)));
DROP POLICY "Users can delete own stories" ON public.stories;
CREATE POLICY "Users can delete own stories" ON public.stories
    FOR DELETE TO authenticated USING ((SELECT public.owns_profile(user_id)));

-- Two ownership checks: the story is mine, or one of my profiles follows its author.
DROP POLICY "Stories visible to owner and followers" ON public.stories;
CREATE POLICY "Stories visible to owner and followers" ON public.stories
    FOR SELECT TO authenticated
    USING (
        (SELECT public.owns_profile(user_id))
        OR EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.followed_id = stories.user_id
              AND (SELECT public.owns_profile(f.follower_id))
        )
    );

DROP POLICY "Users can record own story views" ON public.story_views;
CREATE POLICY "Users can record own story views" ON public.story_views
    FOR INSERT TO authenticated WITH CHECK ((SELECT public.owns_profile(user_id)));
DROP POLICY "Users can update own story views" ON public.story_views;
CREATE POLICY "Users can update own story views" ON public.story_views
    FOR UPDATE TO authenticated
    USING ((SELECT public.owns_profile(user_id)))
    WITH CHECK ((SELECT public.owns_profile(user_id)));

-- Two ownership checks: the view is mine, or the story viewed is.
DROP POLICY "Viewers and owners can see story views" ON public.story_views;
CREATE POLICY "Viewers and owners can see story views" ON public.story_views
    FOR SELECT TO authenticated
    USING (
        (SELECT public.owns_profile(user_id))
        OR EXISTS (
            SELECT 1 FROM public.stories s
            WHERE s.id = story_views.story_id
              AND (SELECT public.owns_profile(s.user_id))
        )
    );

-- ═══════════════════════════════════════
-- notifications
-- ═══════════════════════════════════════

DROP POLICY "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications" ON public.notifications
    FOR SELECT TO authenticated USING ((SELECT public.owns_profile(receiver_id)));
DROP POLICY "Users can send notifications as themselves" ON public.notifications;
CREATE POLICY "Users can send notifications as themselves" ON public.notifications
    FOR INSERT TO authenticated WITH CHECK ((SELECT public.owns_profile(sender_id)));
DROP POLICY "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications" ON public.notifications
    FOR UPDATE TO authenticated
    USING ((SELECT public.owns_profile(receiver_id)))
    WITH CHECK ((SELECT public.owns_profile(receiver_id)));
DROP POLICY "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications" ON public.notifications
    FOR DELETE TO authenticated USING ((SELECT public.owns_profile(receiver_id)));

-- ═══════════════════════════════════════
-- messages
-- ═══════════════════════════════════════

-- Two ownership checks: I sent it, or it was sent to one of my profiles.
DROP POLICY "Users can view own messages" ON public.messages;
CREATE POLICY "Users can view own messages" ON public.messages
    FOR SELECT TO authenticated
    USING ((SELECT public.owns_profile(sender_id)) OR (SELECT public.owns_profile(receiver_id)));

DROP POLICY "Users can send messages as themselves" ON public.messages;
CREATE POLICY "Users can send messages as themselves" ON public.messages
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.owns_profile(sender_id)) AND NOT public.is_blocked_by(receiver_id));

DROP POLICY "Receivers can mark messages seen" ON public.messages;
CREATE POLICY "Receivers can mark messages seen" ON public.messages
    FOR UPDATE TO authenticated
    USING ((SELECT public.owns_profile(receiver_id)))
    WITH CHECK ((SELECT public.owns_profile(receiver_id)));

DROP POLICY "Participants can delete messages" ON public.messages;
CREATE POLICY "Participants can delete messages" ON public.messages
    FOR DELETE TO authenticated
    USING ((SELECT public.owns_profile(sender_id)) OR (SELECT public.owns_profile(receiver_id)));

-- ═══════════════════════════════════════
-- reports — reporter_id references profiles(id)
-- ═══════════════════════════════════════

DROP POLICY "Users can create reports" ON public.reports;
CREATE POLICY "Users can create reports" ON public.reports
    FOR INSERT TO authenticated WITH CHECK ((SELECT public.owns_profile(reporter_id)));
DROP POLICY "Users can view their own reports" ON public.reports;
CREATE POLICY "Users can view their own reports" ON public.reports
    FOR SELECT TO authenticated USING ((SELECT public.owns_profile(reporter_id)));

-- Unchanged, on the account: push_tokens (all four), blocks (all three).
