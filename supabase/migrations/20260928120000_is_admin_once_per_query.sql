-- is_admin() once per query, not once per row (ONE-105).
--
-- Three policies called public.is_admin() bare, so Postgres ran it for every
-- row they checked: every post a feed or a profile read, every post a delete
-- touched, every profile an update touched. Wrapped in (SELECT …) it is an
-- init plan, evaluated once per statement. is_admin() depends only on the
-- caller, never the row, so what each policy allows is unchanged.
--
-- Measured against the app's own PostgREST reads at the ONE-95 100× volume,
-- with identical rows: feed page 1 34.5 → 30.4 ms, feed page 5 30.2 → 26.0 ms,
-- profile grid 10.4 → 9.5 ms, post detail 8.7 → 8.2 ms.
--
-- A set-based rewrite of owns_profile() in the same policies was measured too.
-- It was faster on the feed and slower on a post's detail, so it isn't made
-- here (ONE-105).

DROP POLICY "Posts visible unless author is private" ON public.posts;
CREATE POLICY "Posts visible unless author is private" ON public.posts
    FOR SELECT TO authenticated
    USING (
        (SELECT public.owns_profile(user_id))
        OR (SELECT public.is_admin())
        OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = posts.user_id AND p.is_private)
        OR EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.followed_id = posts.user_id
              AND (SELECT public.owns_profile(f.follower_id))
        )
    );

DROP POLICY "Admins can delete any post" ON public.posts;
CREATE POLICY "Admins can delete any post" ON public.posts
    FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

DROP POLICY "Admins can update profiles" ON public.profiles;
CREATE POLICY "Admins can update profiles" ON public.profiles
    FOR UPDATE TO authenticated
    USING ((SELECT public.is_admin()))
    WITH CHECK ((SELECT public.is_admin()));
