-- Push notifications (ONE-103): what the database queues for send-push.
-- Runs against a real database:
--
--   pnpm db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back, so nothing queued here is
-- ever sent: pg_net only sends what a committed transaction queued.
--
-- S sends; R receives.

BEGIN;
SELECT plan(13);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000103a0', 's@one103.test', '{"username":"one103_s"}'),
  ('00000000-0000-0000-0000-0000000103a1', 'r@one103.test', '{"username":"one103_r"}');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one103_s') AS s,
  (SELECT id FROM public.profiles WHERE username = 'one103_r') AS r;
GRANT SELECT ON ids TO authenticated;

CREATE TEMP TABLE queued_before ON COMMIT DROP AS SELECT coalesce(max(id), 0) AS id FROM net.http_request_queue;

-- What was queued since the start, as { kind, id } bodies.
CREATE FUNCTION pg_temp.queued() RETURNS TABLE (url TEXT, secret TEXT, kind TEXT, row_id UUID)
LANGUAGE sql AS $$
  SELECT q.url, q.headers ->> 'x-push-secret', (convert_from(q.body, 'UTF8')::jsonb) ->> 'kind',
         ((convert_from(q.body, 'UTF8')::jsonb) ->> 'id')::uuid
  FROM net.http_request_queue q, queued_before b
  WHERE q.id > b.id;
$$;

-- ─── Unconfigured: nothing is queued, and nothing fails ───────────────

-- A mention, not a follow: a follow notification here would make the real
-- follow below a repeat within 24 hours, which rightly notifies nobody (ONE-107).
INSERT INTO public.notifications (sender_id, receiver_id, type) SELECT s, r, 'mention' FROM ids;
SELECT is((SELECT count(*)::int FROM pg_temp.queued()), 0,
  'with no send_push_url or send_push_secret in Vault, nothing is queued');

-- ─── Configured ───────────────────────────────────────────────────────

SELECT vault.create_secret('http://send-push.test/functions/v1/send-push', 'send_push_url');
SELECT vault.create_secret('shh-test-secret', 'send_push_secret');

-- A real event, made as a signed-in account: since ONE-107 the database
-- writes its notification, and that queues the push.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000103a0","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.follows (follower_id, followed_id) SELECT s, r FROM ids$$,
  'a signed-in account follows someone');
INSERT INTO public.messages (id, sender_id, receiver_id, text)
SELECT '10300000-0000-0000-0000-000000000007', s, r, 'hello there' FROM ids;
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM pg_temp.queued() q JOIN public.notifications n ON n.id = q.row_id
   WHERE q.kind = 'notification' AND n.type = 'follow'),
  1, 'the follow''s notification, written by the database, queues one push');

-- Each type directly, as the table's owner, since clients can't write
-- notifications (ONE-107).
INSERT INTO public.notifications (id, sender_id, receiver_id, type)
SELECT '10300000-0000-0000-0000-000000000002', s, r, 'follow_request' FROM ids;
INSERT INTO public.notifications (id, sender_id, receiver_id, type)
SELECT '10300000-0000-0000-0000-000000000003', s, r, 'comment' FROM ids;
INSERT INTO public.notifications (id, sender_id, receiver_id, type)
SELECT '10300000-0000-0000-0000-000000000004', s, r, 'mention' FROM ids;
INSERT INTO public.notifications (id, sender_id, receiver_id, type)
SELECT '10300000-0000-0000-0000-000000000005', s, r, 'like' FROM ids;
INSERT INTO public.notifications (id, sender_id, receiver_id, type)
SELECT '10300000-0000-0000-0000-000000000006', s, r, 'repost' FROM ids;

SELECT is(
  (SELECT array_agg(row_id::text ORDER BY row_id) FROM pg_temp.queued()
   WHERE kind = 'notification' AND row_id::text LIKE '10300000%'),
  ARRAY['10300000-0000-0000-0000-000000000002', '10300000-0000-0000-0000-000000000003',
        '10300000-0000-0000-0000-000000000004'],
  'follow_request, comment and mention each queue one push too');
SELECT is((SELECT count(*)::int FROM pg_temp.queued() WHERE row_id = '10300000-0000-0000-0000-000000000005'), 0,
  'a like doesn''t push');
SELECT is((SELECT count(*)::int FROM pg_temp.queued() WHERE row_id = '10300000-0000-0000-0000-000000000006'), 0,
  'a repost doesn''t push');
SELECT is((SELECT kind FROM pg_temp.queued() WHERE row_id = '10300000-0000-0000-0000-000000000007'), 'message',
  'a direct message queues a push of kind message');
SELECT is((SELECT count(*)::int FROM net.http_request_queue q, queued_before b
           WHERE q.id > b.id AND convert_from(q.body, 'UTF8') LIKE '%hello there%'), 0,
  'the message''s text never leaves the database in the push request');
SELECT is((SELECT DISTINCT url FROM pg_temp.queued()), 'http://send-push.test/functions/v1/send-push',
  'each goes to the URL in Vault');
SELECT is((SELECT DISTINCT secret FROM pg_temp.queued()), 'shh-test-secret',
  'carrying the shared secret from Vault');

-- ─── Who may call the helpers ─────────────────────────────────────────

SELECT ok(NOT has_function_privilege('authenticated', 'public.request_push(text, uuid)', 'EXECUTE'),
  'a signed-in user can''t queue a push directly');
SELECT ok(NOT has_function_privilege('anon', 'public.request_push(text, uuid)', 'EXECUTE'),
  'nor can anon');
SELECT ok(NOT has_function_privilege('authenticated', 'public.push_on_insert()', 'EXECUTE'),
  'push_on_insert() runs only as a trigger');

SELECT * FROM finish();
ROLLBACK;
