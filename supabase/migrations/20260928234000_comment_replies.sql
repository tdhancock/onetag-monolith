-- Replies to comments.
--
-- A comment could only answer the post, so a conversation under it was a flat
-- list of people talking past each other. A comment may now reply to another
-- on the same post. Threads are one level deep, as the app draws them: a reply
-- to a reply joins the thread of the comment it answers, and its author is
-- reached through the @handle the app puts in front of it.
--
--   parent_id              the comment a reply answers; deleting that comment
--                          deletes its replies with it
--   comments_thread        a reply's parent must be a comment the replier can
--                          see on the same post; a comment never moves
--   'reply'                a notification to the author of the comment
--                          replied to, which pushes as a comment does
--
-- Each comment notifies a person once (notify): someone replied to on their
-- own post hears that it was a reply, not also that it was a comment, and a
-- reply that names them hears nothing more for the name.

ALTER TABLE public.comments
    ADD COLUMN parent_id UUID REFERENCES public.comments(id) ON DELETE CASCADE;

CREATE INDEX idx_comments_parent ON public.comments (parent_id) WHERE parent_id IS NOT NULL;

-- ─── Where a reply goes ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.thread_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  parent_post UUID;
  parent_parent UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.post_id IS DISTINCT FROM OLD.post_id THEN
      RAISE EXCEPTION 'A comment stays where it was posted' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Read as the replier: a comment they can't see is one they can't answer.
  SELECT c.post_id, c.parent_id INTO parent_post, parent_parent
  FROM public.comments c
  WHERE c.id = NEW.parent_id;

  IF NOT FOUND OR parent_post IS DISTINCT FROM NEW.post_id THEN
    RAISE EXCEPTION 'No comment % on this post to reply to', NEW.parent_id USING ERRCODE = '23503';
  END IF;

  -- One level deep: a reply to a reply joins its thread.
  IF parent_parent IS NOT NULL THEN
    NEW.parent_id := parent_parent;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.thread_comment() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER comments_thread BEFORE INSERT OR UPDATE ON public.comments
    FOR EACH ROW EXECUTE FUNCTION public.thread_comment();

-- ─── The notification ─────────────────────────────────────────────────

ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('like', 'comment', 'reply', 'follow', 'follow_request', 'comment_like', 'repost', 'mention', 'story_like'));

-- As before (20260928170000), plus: a comment notifies each person once.
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
  IF p_comment IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.comment_id = p_comment AND n.receiver_id = p_receiver
  ) THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (sender_id, receiver_id, type, post_id, comment_id, content)
  VALUES (p_sender, p_receiver, p_type, p_post, p_comment, p_content);
END;
$$;

REVOKE ALL ON FUNCTION public.notify(TEXT, UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- As before, and a reply tells the author of the comment it answers first,
-- so that is what they hear.
CREATE OR REPLACE FUNCTION public.notify_on_engagement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  author UUID;
  replied_to UUID;
BEGIN
  SELECT p.user_id INTO author FROM public.posts p WHERE p.id = NEW.post_id;

  IF TG_TABLE_NAME = 'likes' THEN
    PERFORM public.notify('like', NEW.user_id, author, NEW.post_id);
  ELSIF TG_TABLE_NAME = 'reposts' THEN
    PERFORM public.notify('repost', NEW.user_id, author, NEW.post_id);
  ELSE
    IF NEW.parent_id IS NOT NULL THEN
      SELECT c.user_id INTO replied_to FROM public.comments c WHERE c.id = NEW.parent_id;
      PERFORM public.notify('reply', NEW.user_id, replied_to, NEW.post_id, NEW.id, left(NEW.content, 50));
    END IF;
    PERFORM public.notify('comment', NEW.user_id, author, NEW.post_id, NEW.id, left(NEW.content, 50));
    PERFORM public.notify_mentions(NEW.content, NEW.user_id, NEW.post_id, NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_on_engagement() FROM PUBLIC, anon, authenticated;

-- A reply pushes, as a comment does (send-push knows the type).
DROP TRIGGER notifications_push ON public.notifications;
CREATE TRIGGER notifications_push
    AFTER INSERT ON public.notifications
    FOR EACH ROW
    WHEN (NEW.type IN ('follow', 'follow_request', 'comment', 'reply', 'mention'))
    EXECUTE FUNCTION public.push_on_insert();
