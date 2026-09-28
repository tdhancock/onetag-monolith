-- Notifications come from events, never from clients (ONE-107).
--
-- The app wrote every notification itself, and the only rule was that the
-- sender was the caller. So anyone could write a follow, comment, mention or
-- follow-request notification for something that never happened, as often as
-- they liked, even to someone who had blocked them. Since ONE-103 each of
-- those also pushes to a phone.
--
-- Now each is written by a trigger on the event itself, and clients can't
-- insert into notifications at all:
--
--   likes insert            → 'like' to the post's author
--   reposts insert          → 'repost' to the post's author
--   comments insert         → 'comment' to the post's author, and 'mention'
--                             to each @handle in the text
--   posts insert            → 'mention' to each @handle in the text
--   follows insert          → 'follow', at most once per follower per 24 h
--                             (decided 2026-09-27), and not for a follow made
--                             by approving a request
--   follow_requests insert  → 'follow_request'; deleting the request
--                             (cancelled, declined or approved) deletes its
--                             unread notification
--
-- Nobody is notified about their own action, or across a block either way
-- (ONE-108). The rows carry what the app's writes carried: post and comment
-- ids, and the first 50 characters of a comment's or mention's text. A handle
-- is what the app matched, @ followed by letters, digits and underscores, and
-- each is notified once however often it appears.

-- ─── Is there a block between two profiles, either way? ───────────────

CREATE OR REPLACE FUNCTION public.blocked_between(p_a UUID, p_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles a, public.profiles b, public.blocks k
    WHERE a.id = p_a AND b.id = p_b
      AND ((k.blocker_id = a.user_id AND k.blocked_id = b.user_id)
        OR (k.blocker_id = b.user_id AND k.blocked_id = a.user_id))
  );
$$;

REVOKE ALL ON FUNCTION public.blocked_between(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ─── Write one notification, unless it shouldn't be ───────────────────

CREATE OR REPLACE FUNCTION public.notify(
    p_type TEXT,
    p_sender UUID,
    p_receiver UUID,
    p_post UUID DEFAULT NULL,
    p_comment UUID DEFAULT NULL,
    p_content TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_receiver IS NULL OR p_sender IS NULL OR p_receiver = p_sender THEN
    RETURN;
  END IF;
  IF public.blocked_between(p_sender, p_receiver) THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (sender_id, receiver_id, type, post_id, comment_id, content)
  VALUES (p_sender, p_receiver, p_type, p_post, p_comment, p_content);
END;
$$;

REVOKE ALL ON FUNCTION public.notify(TEXT, UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ─── Mentions in a text ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_mentions(
    p_text TEXT,
    p_sender UUID,
    p_post UUID,
    p_comment UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  mentioned UUID;
BEGIN
  IF p_text IS NULL OR position('@' IN p_text) = 0 THEN
    RETURN;
  END IF;
  FOR mentioned IN
    SELECT DISTINCT p.id
    FROM regexp_matches(p_text, '@([A-Za-z0-9_]+)', 'g') AS m(handle)
    JOIN public.profiles p ON p.username = m.handle[1]
  LOOP
    PERFORM public.notify('mention', p_sender, mentioned, p_post, p_comment, left(p_text, 50));
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_mentions(TEXT, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ─── The events ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_on_engagement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  author UUID;
BEGIN
  SELECT p.user_id INTO author FROM public.posts p WHERE p.id = NEW.post_id;

  IF TG_TABLE_NAME = 'likes' THEN
    PERFORM public.notify('like', NEW.user_id, author, NEW.post_id);
  ELSIF TG_TABLE_NAME = 'reposts' THEN
    PERFORM public.notify('repost', NEW.user_id, author, NEW.post_id);
  ELSE
    PERFORM public.notify('comment', NEW.user_id, author, NEW.post_id, NEW.id, left(NEW.content, 50));
    PERFORM public.notify_mentions(NEW.content, NEW.user_id, NEW.post_id, NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_on_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.notify_mentions(NEW.content, NEW.user_id, NEW.id, NULL);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_on_follow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Made by approving a request, or by going public: the owner chose it, so
  -- there's nothing to tell them (approve_follow_request, promote_follow_requests).
  IF current_setting('onetag.follow_from_request', true) = 'on' THEN
    RETURN NULL;
  END IF;

  -- Once per follower per 24 hours, so following, unfollowing and following
  -- again can't repeat it.
  IF EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.type = 'follow'
      AND n.sender_id = NEW.follower_id
      AND n.receiver_id = NEW.followed_id
      AND n.created_at > now() - interval '24 hours'
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM public.notify('follow', NEW.follower_id, NEW.followed_id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_on_follow_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.notify('follow_request', NEW.requester_profile_id, NEW.target_profile_id);
  ELSE
    -- Cancelled, declined or approved: the request is settled, so its unread
    -- notification would only lead to an empty screen.
    DELETE FROM public.notifications n
    WHERE n.type = 'follow_request'
      AND n.sender_id = OLD.requester_profile_id
      AND n.receiver_id = OLD.target_profile_id
      AND NOT n.is_read;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_on_engagement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_on_post() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_on_follow() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_on_follow_request() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER likes_notify AFTER INSERT ON public.likes
    FOR EACH ROW EXECUTE FUNCTION public.notify_on_engagement();
CREATE TRIGGER reposts_notify AFTER INSERT ON public.reposts
    FOR EACH ROW EXECUTE FUNCTION public.notify_on_engagement();
CREATE TRIGGER comments_notify AFTER INSERT ON public.comments
    FOR EACH ROW EXECUTE FUNCTION public.notify_on_engagement();
CREATE TRIGGER posts_notify AFTER INSERT ON public.posts
    FOR EACH ROW EXECUTE FUNCTION public.notify_on_post();
CREATE TRIGGER follows_notify AFTER INSERT ON public.follows
    FOR EACH ROW EXECUTE FUNCTION public.notify_on_follow();
CREATE TRIGGER follow_requests_notify AFTER INSERT OR DELETE ON public.follow_requests
    FOR EACH ROW EXECUTE FUNCTION public.notify_on_follow_request();

-- ─── A follow made from a request says so, for notify_on_follow ───────

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

  PERFORM set_config('onetag.follow_from_request', 'on', true);
  INSERT INTO public.follows (follower_id, followed_id)
  VALUES (req.requester_profile_id, req.target_profile_id)
  ON CONFLICT DO NOTHING;
  PERFORM set_config('onetag.follow_from_request', 'off', true);

  DELETE FROM public.follow_requests WHERE id = req.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_follow_requests()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM set_config('onetag.follow_from_request', 'on', true);
  INSERT INTO public.follows (follower_id, followed_id)
  SELECT requester_profile_id, target_profile_id
  FROM public.follow_requests
  WHERE target_profile_id = NEW.id
  ON CONFLICT DO NOTHING;
  PERFORM set_config('onetag.follow_from_request', 'off', true);

  DELETE FROM public.follow_requests WHERE target_profile_id = NEW.id;
  RETURN NULL;
END;
$$;

-- ─── Clients write no notifications ───────────────────────────────────

DROP POLICY "Users can send notifications as themselves" ON public.notifications;
REVOKE INSERT ON public.notifications FROM anon, authenticated;
