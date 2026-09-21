-- Admin role (server-enforced) and private-account post visibility.

ALTER TABLE public.profiles ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((SELECT is_admin FROM public.profiles WHERE id = (SELECT auth.uid())), false);
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- is_admin can only be changed by service_role / postgres (e.g. SQL editor).
-- is_verified can additionally be changed by admins.
CREATE OR REPLACE FUNCTION public.protect_profile_verified()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  privileged BOOLEAN := current_user IN ('postgres', 'supabase_admin', 'service_role')
                        OR coalesce(auth.role(), 'service_role') = 'service_role';
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin AND NOT privileged THEN
    RAISE EXCEPTION 'is_admin can only be changed by the database owner';
  END IF;
  IF NEW.is_verified IS DISTINCT FROM OLD.is_verified AND NOT privileged AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'is_verified can only be changed by an administrator';
  END IF;
  RETURN NEW;
END;
$$;

-- Admins can update any profile (used for verification) and delete any post.
CREATE POLICY "Admins can update profiles" ON public.profiles
    FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins can delete any post" ON public.posts
    FOR DELETE TO authenticated USING (public.is_admin());

-- Private accounts: posts visible to the owner, followers, and admins only.
DROP POLICY "Posts are viewable by authenticated users" ON public.posts;
CREATE POLICY "Posts visible unless author is private" ON public.posts
    FOR SELECT TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR public.is_admin()
        OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = posts.user_id AND p.is_private)
        OR EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = (SELECT auth.uid()) AND f.followed_id = posts.user_id
        )
    );
