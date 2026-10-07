-- Replies to comments. Runs against a real database:
--
--   pnpm db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- A posts. B comments on it. C replies to B, then to C's own reply. A
-- replies to B, naming B. D is blocked by B.

BEGIN;
SELECT plan(17);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-00000000c0a0', 'a@replies.test', '{"username":"replies_a"}'),
  ('00000000-0000-0000-0000-00000000c0a1', 'b@replies.test', '{"username":"replies_b"}'),
  ('00000000-0000-0000-0000-00000000c0a2', 'c@replies.test', '{"username":"replies_c"}'),
  ('00000000-0000-0000-0000-00000000c0a3', 'd@replies.test', '{"username":"replies_d"}');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'replies_a') AS a,
  (SELECT id FROM public.profiles WHERE username = 'replies_b') AS b,
  (SELECT id FROM public.profiles WHERE username = 'replies_c') AS c,
  (SELECT id FROM public.profiles WHERE username = 'replies_d') AS d;
GRANT SELECT ON ids TO authenticated;

INSERT INTO public.posts (id, user_id, content) VALUES
  ('c0000000-0000-0000-0000-000000000001', (SELECT a FROM ids), 'A''s post'),
  ('c0000000-0000-0000-0000-000000000002', (SELECT a FROM ids), 'A''s other post');
INSERT INTO public.blocks (blocker_id, blocked_id) VALUES
  ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-00000000c0a3');

-- What someone has been told, read as the table's owner.
CREATE FUNCTION pg_temp.told(p_receiver UUID, p_type TEXT) RETURNS INTEGER
LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.notifications WHERE receiver_id = p_receiver AND type = p_type;
$$;

SELECT has_column('public', 'comments', 'parent_id', 'a comment can name the comment it replies to');

-- ─── B comments; C replies ────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0a1","role":"authenticated"}', true);
INSERT INTO public.comments (id, post_id, user_id, content)
SELECT 'c0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000001', b, 'nice' FROM ids;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0a2","role":"authenticated"}', true);
INSERT INTO public.comments (id, post_id, user_id, content, parent_id)
SELECT 'c0000000-0000-0000-0000-000000000012', 'c0000000-0000-0000-0000-000000000001', c, 'agreed',
       'c0000000-0000-0000-0000-000000000011' FROM ids;
INSERT INTO public.comments (id, post_id, user_id, content, parent_id)
SELECT 'c0000000-0000-0000-0000-000000000013', 'c0000000-0000-0000-0000-000000000001', c, 'and another thing',
       'c0000000-0000-0000-0000-000000000012' FROM ids;

SELECT is(
  (SELECT parent_id FROM public.comments WHERE id = 'c0000000-0000-0000-0000-000000000012'),
  'c0000000-0000-0000-0000-000000000011'::uuid, 'a reply names the comment it answers');
SELECT is(
  (SELECT parent_id FROM public.comments WHERE id = 'c0000000-0000-0000-0000-000000000013'),
  'c0000000-0000-0000-0000-000000000011'::uuid, 'a reply to a reply joins that comment''s thread, one level deep');

SELECT throws_ok(
  $$INSERT INTO public.comments (post_id, user_id, content, parent_id)
    SELECT 'c0000000-0000-0000-0000-000000000002', c, 'wrong post', 'c0000000-0000-0000-0000-000000000011' FROM ids$$,
  '23503', NULL, 'a reply stays on the post of the comment it answers');
SELECT throws_ok(
  $$INSERT INTO public.comments (post_id, user_id, content, parent_id)
    SELECT 'c0000000-0000-0000-0000-000000000001', c, 'to nothing', gen_random_uuid() FROM ids$$,
  '23503', NULL, 'nor answers a comment that isn''t there');
SELECT throws_ok(
  $$UPDATE public.comments SET parent_id = NULL WHERE id = 'c0000000-0000-0000-0000-000000000012'$$,
  '42501', NULL, 'a comment never moves out of its thread');
SELECT lives_ok(
  $$UPDATE public.comments SET content = 'agreed!' WHERE id = 'c0000000-0000-0000-0000-000000000012'$$,
  'though its text can still change');

-- D can't see B's comment, B having blocked D, so can't answer it.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0a3","role":"authenticated"}', true);
SELECT throws_ok(
  $$INSERT INTO public.comments (post_id, user_id, content, parent_id)
    SELECT 'c0000000-0000-0000-0000-000000000001', d, 'hi', 'c0000000-0000-0000-0000-000000000011' FROM ids$$,
  '23503', NULL, 'nobody replies to a comment hidden from them by a block');

-- A replies to B on A's own post, naming B.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0a0","role":"authenticated"}', true);
INSERT INTO public.comments (id, post_id, user_id, content, parent_id)
SELECT 'c0000000-0000-0000-0000-000000000014', 'c0000000-0000-0000-0000-000000000001', a, '@replies_b thanks',
       'c0000000-0000-0000-0000-000000000011' FROM ids;
RESET ROLE;

-- ─── Who is told ──────────────────────────────────────────────────────

SELECT is(pg_temp.told((SELECT b FROM ids), 'reply'), 3, 'the author of a comment hears of each reply to it');
SELECT is(
  (SELECT content FROM public.notifications
   WHERE receiver_id = (SELECT b FROM ids) AND type = 'reply' AND comment_id = 'c0000000-0000-0000-0000-000000000012'),
  'agreed', 'naming the reply, with its text');
SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE receiver_id = (SELECT b FROM ids) AND comment_id = 'c0000000-0000-0000-0000-000000000014'),
  1, 'a reply that also names them tells them once, as a reply');
SELECT is(pg_temp.told((SELECT a FROM ids), 'comment'), 3, 'the post''s author still hears of every comment on it but their own');
SELECT is(pg_temp.told((SELECT c FROM ids), 'reply'), 0, 'replying in your own thread tells you nothing');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'notifications_push'
          AND pg_get_triggerdef(oid) LIKE '%''reply''%'),
  'a reply pushes, as a comment does');

-- ─── Deleting a comment takes its replies ─────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0a1","role":"authenticated"}', true);
DELETE FROM public.comments WHERE id = 'c0000000-0000-0000-0000-000000000011';
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.comments WHERE post_id = 'c0000000-0000-0000-0000-000000000001'),
  0, 'deleting a comment deletes the replies under it');

-- ─── Who may call it ──────────────────────────────────────────────────

SELECT ok(
  NOT has_function_privilege('anon', 'public.thread_comment()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.thread_comment()', 'EXECUTE'),
  'thread_comment() runs only as a trigger');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.notify(text, uuid, uuid, uuid, uuid, text)', 'EXECUTE'),
  'notify() is still the database''s alone');

SELECT * FROM finish();
ROLLBACK;
