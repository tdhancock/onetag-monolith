-- Follow requests for private accounts (ONE-63).
--
-- ONE-58 let a profile go private: its posts and OneSnaps are hidden from
-- anyone who doesn't follow it. But following stayed instant, and the follows
-- INSERT policy never looked at the target's privacy, so anyone could follow
-- a private profile — through the app or straight through the API — and see
-- everything at once.
--
-- A private profile is now followed by request. A request is its own row in
-- follow_requests, promoted into follows when the owner approves it. It is
-- deliberately not a status column on follows: a pending request is never a
-- follow, so every existing reader of follows — follower counts, the feed,
-- the post and OneSnap visibility policies, Explore — stays correct as it is.
--
-- Going public approves whatever is pending. Going private evicts nobody
-- (ONE-58); existing follows of a private profile are untouched.

-- ─── The table ────────────────────────────────────────────────────────

CREATE TABLE public.follow_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    target_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT follow_requests_once UNIQUE (requester_profile_id, target_profile_id),
    CONSTRAINT follow_requests_not_self CHECK (requester_profile_id <> target_profile_id)
);

-- The owner's list, newest first. The unique constraint's index serves the
-- requester's side.
CREATE INDEX follow_requests_target_created_at
    ON public.follow_requests (target_profile_id, created_at DESC);

-- ─── RLS ──────────────────────────────────────────────────────────────

ALTER TABLE public.follow_requests ENABLE ROW LEVEL SECURITY;

-- Both sides see a request: the requester to show Requested, the owner to
-- approve or decline it. Nobody else does.
CREATE POLICY "Requests visible to both sides" ON public.follow_requests
    FOR SELECT TO authenticated USING (
        (SELECT public.owns_profile(requester_profile_id))
        OR (SELECT public.owns_profile(target_profile_id))
    );

-- A request is made as yourself, to a private profile, across no block in
-- either direction (as ONE-93 uses hidden_by_block), and only by someone who
-- doesn't already follow it.
CREATE POLICY "Users can request to follow private profiles" ON public.follow_requests
    FOR INSERT TO authenticated WITH CHECK (
        (SELECT public.owns_profile(requester_profile_id))
        AND EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = target_profile_id AND p.is_private
        )
        AND NOT public.hidden_by_block(target_profile_id)
        AND NOT EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = requester_profile_id
              AND f.followed_id = target_profile_id
        )
    );

-- Either side removes it: the requester cancels, the owner declines.
CREATE POLICY "Either side can remove a request" ON public.follow_requests
    FOR DELETE TO authenticated USING (
        (SELECT public.owns_profile(requester_profile_id))
        OR (SELECT public.owns_profile(target_profile_id))
    );

-- No update policy: a request has nothing to edit. Approving it is
-- approve_follow_request, below.

-- ─── Following a private profile directly is refused ──────────────────
--
-- The gate is here, not only in the app, so a direct API insert can't skip
-- the request. Following a profile of your own account stays allowed, private
-- or not.

DROP POLICY "Users can follow as themselves" ON public.follows;
CREATE POLICY "Users can follow as themselves" ON public.follows
    FOR INSERT TO authenticated WITH CHECK (
        (SELECT public.owns_profile(follower_id))
        AND (
            NOT EXISTS (
                SELECT 1 FROM public.profiles p
                WHERE p.id = followed_id AND p.is_private
            )
            OR (SELECT public.owns_profile(followed_id))
        )
    );

-- ─── Approving ────────────────────────────────────────────────────────
--
-- SECURITY DEFINER because the follow it inserts is one the follows policy
-- above refuses to the requester, and one the owner can't insert as
-- themselves (they don't own follower_id). It checks the caller owns the
-- request's target before doing anything.

CREATE OR REPLACE FUNCTION public.approve_follow_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  req public.follow_requests%ROWTYPE;
BEGIN
  SELECT * INTO req FROM public.follow_requests WHERE id = p_request_id;

  -- Not found and not yours read the same, so a request id reveals nothing.
  IF NOT FOUND OR NOT public.owns_profile(req.target_profile_id) THEN
    RAISE EXCEPTION 'No follow request % for this account', p_request_id
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.follows (follower_id, followed_id)
  VALUES (req.requester_profile_id, req.target_profile_id)
  ON CONFLICT DO NOTHING;

  DELETE FROM public.follow_requests WHERE id = req.id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_follow_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_follow_request(UUID) TO authenticated;

-- ─── Going public approves what is pending ────────────────────────────

CREATE OR REPLACE FUNCTION public.promote_follow_requests()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.follows (follower_id, followed_id)
  SELECT requester_profile_id, target_profile_id
  FROM public.follow_requests
  WHERE target_profile_id = NEW.id
  ON CONFLICT DO NOTHING;

  DELETE FROM public.follow_requests WHERE target_profile_id = NEW.id;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_follow_requests() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER profiles_promote_follow_requests
    AFTER UPDATE OF is_private ON public.profiles
    FOR EACH ROW
    WHEN (OLD.is_private AND NOT NEW.is_private)
    EXECUTE FUNCTION public.promote_follow_requests();

-- ─── The owner hears about each request ───────────────────────────────

ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('like', 'comment', 'follow', 'follow_request', 'comment_like', 'repost', 'mention', 'story_like'));

-- ─── Search results say which profiles are private ────────────────────
--
-- So the Follow button on a search result can ask rather than follow, as
-- every other Follow button does. A column added to a RETURNS TABLE changes
-- the function's type, which CREATE OR REPLACE can't do, so it is dropped and
-- made again, grants included. The body is ONE-48's, unchanged.

DROP FUNCTION public.search_profiles(TEXT, INTEGER);

CREATE FUNCTION public.search_profiles(p_query TEXT, p_limit INTEGER DEFAULT 30)
RETURNS TABLE (
    id UUID,
    username TEXT,
    full_name TEXT,
    avatar_url TEXT,
    is_verified BOOLEAN,
    profile_type TEXT,
    is_private BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH q AS (
    -- ILIKE wildcards in what was typed are matched literally.
    SELECT replace(replace(replace(lower(trim(p_query)), '\', '\\'), '%', '\%'), '_', '\_') AS term
  )
  SELECT p.id, p.username, p.full_name, p.avatar_url, p.is_verified, p.profile_type, p.is_private
  FROM public.profiles p, q
  WHERE q.term <> ''
    AND (p.username ILIKE '%' || q.term || '%' OR p.full_name ILIKE '%' || q.term || '%')
    AND NOT public.hidden_by_block(p.id)
  ORDER BY
    (p.username ILIKE q.term || '%') DESC,
    (p.full_name ILIKE q.term || '%') DESC,
    lower(p.username)
  LIMIT least(greatest(coalesce(p_limit, 30), 1), 60);
$$;

REVOKE ALL ON FUNCTION public.search_profiles(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_profiles(TEXT, INTEGER) TO authenticated;
