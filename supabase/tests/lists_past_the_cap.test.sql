-- Lists that don't stop at 1,000 rows (ONE-110). Runs against a real
-- database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back. The 1,000-row cap is
-- the API's, so these pin what each function returns; the API check proves
-- the app reads past the cap through them.
--
-- X and Y share a 250-message thread, with ties on created_at. X also
-- messaged Z an hour ago and W a month ago. X follows 1,100 profiles, one
-- with a mixed-case handle, and has asked to follow private P.

BEGIN;
SELECT plan(24);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000110a0', 'x@one110.test', '{"username":"one110_x"}'),
  ('00000000-0000-0000-0000-0000000110a1', 'y@one110.test', '{"username":"one110_y"}'),
  ('00000000-0000-0000-0000-0000000110a2', 'z@one110.test', '{"username":"one110_z"}'),
  ('00000000-0000-0000-0000-0000000110a3', 'w@one110.test', '{"username":"one110_w"}'),
  ('00000000-0000-0000-0000-0000000110a4', 'p@one110.test', '{"username":"one110_p"}'),
  ('00000000-0000-0000-0000-0000000110a5', 'm@one110.test', '{"username":"One110_Mixed"}');
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT gen_random_uuid(), 'f' || g || '@one110.test', jsonb_build_object('username', 'one110_f' || g)
FROM generate_series(1, 1099) g;

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one110_x') AS x,
  (SELECT id FROM public.profiles WHERE username = 'one110_y') AS y,
  (SELECT id FROM public.profiles WHERE username = 'one110_z') AS z,
  (SELECT id FROM public.profiles WHERE username = 'one110_w') AS w,
  (SELECT id FROM public.profiles WHERE username = 'one110_p') AS p;
GRANT SELECT ON ids TO authenticated;

UPDATE public.profiles SET is_private = true WHERE username = 'one110_p';
-- Signup lowercases a handle; one made before it did keeps its capitals.
UPDATE public.profiles SET username = 'One110_Mixed' WHERE username = 'one110_mixed';

-- 250 messages, alternating senders, a minute apart; m5, m15, … share a
-- minute with the one before, so paging has ties to get right. The newest
-- stands alone, so which message is newest never depends on random ids.
INSERT INTO public.messages (sender_id, receiver_id, text, created_at)
SELECT CASE WHEN g % 2 = 0 THEN ids.x ELSE ids.y END,
       CASE WHEN g % 2 = 0 THEN ids.y ELSE ids.x END,
       'm' || g,
       now() - interval '1 day' + (g - CASE WHEN g % 10 = 5 THEN 1 ELSE 0 END) * interval '1 minute'
FROM ids, generate_series(1, 250) g;
INSERT INTO public.messages (sender_id, receiver_id, text, created_at)
SELECT x, z, 'to z', now() - interval '1 hour' FROM ids
UNION ALL SELECT w, x, 'from w', now() - interval '30 days' FROM ids
UNION ALL SELECT y, z, 'not x', now() FROM ids;

INSERT INTO public.follows (follower_id, followed_id)
SELECT ids.x, p.id FROM ids, public.profiles p
WHERE p.username LIKE 'one110\_f%' OR p.username = 'One110_Mixed';
INSERT INTO public.follow_requests (requester_profile_id, target_profile_id) SELECT x, p FROM ids;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000110a0","role":"authenticated"}', true);

-- ─── A thread, a page at a time ───────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.messages_thread((SELECT x FROM ids), (SELECT y FROM ids))),
  100, 'a thread opens on one page of 100');
SELECT is(
  (SELECT text FROM public.messages_thread((SELECT x FROM ids), (SELECT y FROM ids)) LIMIT 1),
  'm250', 'newest first: the page starts at the latest message');
SELECT is(
  (SELECT array_agg(text) FROM public.messages_thread((SELECT x FROM ids), (SELECT y FROM ids), NULL, NULL, 3)),
  ARRAY['m250', 'm249', 'm248'], 'a smaller page, still newest first');
SELECT is(
  (SELECT count(*)::int FROM public.messages_thread((SELECT x FROM ids), (SELECT y FROM ids), NULL, NULL, 5000)),
  200, 'a page never holds more than 200');
SELECT is(
  (SELECT count(*)::int FROM public.messages_thread((SELECT x FROM ids), (SELECT y FROM ids), NULL, NULL, 0)),
  1, 'nor fewer than one');

-- Page back from the newest to the first, as the app does: each page starts
-- before the oldest message of the last.
CREATE TEMP TABLE walked (text TEXT, created_at TIMESTAMPTZ, id UUID, page INT) ON COMMIT DROP;
GRANT ALL ON walked TO authenticated;
DO $$
DECLARE
  cursor_at TIMESTAMPTZ := NULL;
  cursor_id UUID := NULL;
  pages INT := 0;
  got INT;
BEGIN
  LOOP
    pages := pages + 1;
    INSERT INTO walked
    SELECT t.text, t.created_at, t.id, pages
    FROM public.messages_thread((SELECT x FROM ids), (SELECT y FROM ids), cursor_at, cursor_id, 7) t;
    GET DIAGNOSTICS got = ROW_COUNT;
    EXIT WHEN got < 7 OR pages > 100;
    SELECT w.created_at, w.id INTO cursor_at, cursor_id
    FROM walked w WHERE w.page = pages ORDER BY w.created_at, w.id LIMIT 1;
  END LOOP;
END $$;

SELECT is((SELECT count(*)::int FROM walked), 250, 'paging back reaches every message of the thread');
SELECT is((SELECT count(DISTINCT id)::int FROM walked), 250, 'each exactly once, ties on the minute included');
SELECT is((SELECT text FROM walked ORDER BY page DESC, created_at, id LIMIT 1), 'm1', 'ending on the first');
SELECT is(
  (SELECT count(*)::int FROM walked WHERE text IN ('to z', 'from w', 'not x')),
  0, 'and nothing from anyone else''s conversation');

SELECT is(
  (SELECT count(*)::int FROM public.messages_thread((SELECT x FROM ids), (SELECT y FROM ids),
     (SELECT created_at FROM public.messages WHERE text = 'm10'), NULL, 200)),
  9, 'given only a time, it reads what came before that time');

-- ─── The Messages list ────────────────────────────────────────────────

SELECT is(
  (SELECT array_agg(username ORDER BY ord) FROM public.chat_list((SELECT x FROM ids)) WITH ORDINALITY AS c(id, full_name, username, avatar_url, is_verified, last_message_at, ord)),
  ARRAY['one110_z', 'one110_y', 'one110_w'],
  'everyone I have messaged, either way, latest conversation first');
SELECT is(
  (SELECT last_message_at FROM public.chat_list((SELECT x FROM ids)) WHERE username = 'one110_y'),
  (SELECT max(created_at) FROM public.messages WHERE text LIKE 'm%'),
  'each with the time of its latest message');
SELECT is(
  (SELECT last_message_at FROM public.chat_list((SELECT x FROM ids)) WHERE username = 'one110_w'),
  now() - interval '30 days',
  'a conversation from a month ago, behind 250 newer messages, is still there');

-- ─── Follow and request state ─────────────────────────────────────────

SELECT is(
  cardinality(public.following_usernames((SELECT x FROM ids))),
  1100, 'every one of 1,100 follows, in one value');
SELECT ok(
  'one110_mixed' = ANY (public.following_usernames((SELECT x FROM ids))),
  'handles lowercased, as the app compares them');
SELECT is(
  public.requested_usernames((SELECT x FROM ids)),
  ARRAY['one110_p'], 'the private profile I asked to follow');
SELECT is(
  public.following_usernames((SELECT y FROM ids)),
  '{}'::text[], 'someone who follows nobody gets an empty list, not null');

-- ─── As someone else ──────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000110a2","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.messages_thread((SELECT x FROM ids), (SELECT y FROM ids))),
  0, 'someone else can''t read X and Y''s thread');
SELECT is(
  (SELECT array_agg(username) FROM public.chat_list((SELECT x FROM ids))),
  ARRAY['one110_z'], 'asked for X''s list, Z sees only their own conversation with X');
SELECT is(
  public.requested_usernames((SELECT x FROM ids)),
  '{}'::text[], 'nor X''s pending requests');
SELECT is(
  cardinality(public.following_usernames((SELECT x FROM ids))),
  (SELECT count(*)::int FROM public.follows WHERE follower_id = (SELECT x FROM ids)),
  'follows are public, so following state reads as the follows table does');

-- ─── Who may call them ────────────────────────────────────────────────

RESET ROLE;
SELECT ok(
  NOT has_function_privilege('anon', 'public.messages_thread(uuid, uuid, timestamptz, uuid, integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.chat_list(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.following_usernames(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.requested_usernames(uuid)', 'EXECUTE'),
  'anon can call none of them');
SELECT ok(
  has_function_privilege('authenticated', 'public.messages_thread(uuid, uuid, timestamptz, uuid, integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.chat_list(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.following_usernames(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.requested_usernames(uuid)', 'EXECUTE'),
  'signed-in users can call all four');
SELECT hasnt_function('public', 'chat_partners', ARRAY['uuid'], 'chat_partners() is gone: chat_list() replaces it');

SELECT * FROM finish();
ROLLBACK;
