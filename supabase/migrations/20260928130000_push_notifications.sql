-- Push notifications (ONE-103).
--
-- The app registered push tokens and routed a tapped push, but nothing ever
-- sent one. Now a new notification of a type that pushes, or a new direct
-- message, queues a POST to the send-push edge function through pg_net. The
-- function loads the row with the service role and sends through Expo
-- (supabase/functions/send-push).
--
-- Decided 2026-09-27: follow, follow_request, comment and mention push, and so
-- do messages. Likes, reposts, comment likes and OneSnap likes don't.
--
-- pg_net sends after the transaction commits, from a background worker, so an
-- insert never waits on the network. A failure to queue a push never fails the
-- insert either: a notification that arrives without a push is fine; one that
-- can't be written because a push couldn't be queued is not.
--
-- Where to send, and the shared secret, live in Vault, not in this migration:
-- `send_push_url` and `send_push_secret`. Until both are set nothing is
-- queued, which is how the local stack and the test suite run.
-- docs/push-notifications.md has the setup.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.request_push(p_kind TEXT, p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target TEXT;
  secret TEXT;
BEGIN
  SELECT decrypted_secret INTO target FROM vault.decrypted_secrets WHERE name = 'send_push_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'send_push_secret';
  IF target IS NULL OR secret IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := target,
    body := jsonb_build_object('kind', p_kind, 'id', p_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret),
    timeout_milliseconds := 5000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not queue a push for % %: %', p_kind, p_id, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.request_push(TEXT, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.push_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.request_push(
    CASE WHEN TG_TABLE_NAME = 'messages' THEN 'message' ELSE 'notification' END,
    NEW.id
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.push_on_insert() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER notifications_push
    AFTER INSERT ON public.notifications
    FOR EACH ROW
    WHEN (NEW.type IN ('follow', 'follow_request', 'comment', 'mention'))
    EXECUTE FUNCTION public.push_on_insert();

CREATE TRIGGER messages_push
    AFTER INSERT ON public.messages
    FOR EACH ROW
    EXECUTE FUNCTION public.push_on_insert();
