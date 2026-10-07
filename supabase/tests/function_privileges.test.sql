-- Who may call which function (ONE-85). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Supabase grants EXECUTE on every new public function to anon directly, so
-- a function only signed-in callers should run revokes FROM PUBLIC, anon —
-- not PUBLIC alone. This pins both sides: the signed-in-only functions refuse
-- anon and still serve authenticated, and the ones anonymous callers need
-- stay open to them.

BEGIN;
SELECT plan(62);

-- ─── Signed-in only: anon refused ─────────────────────────────────────

SELECT ok(NOT has_function_privilege('anon', 'public.is_admin()', 'EXECUTE'),
  'anon cannot execute is_admin()');
SELECT ok(NOT has_function_privilege('anon', 'public.is_blocked_by(uuid)', 'EXECUTE'),
  'anon cannot execute is_blocked_by()');
SELECT ok(NOT has_function_privilege('anon', 'public.delete_chat_history(uuid, uuid)', 'EXECUTE'),
  'anon cannot execute delete_chat_history()');
SELECT ok(NOT has_function_privilege('anon', 'public.delete_conversation(uuid, uuid)', 'EXECUTE'),
  'anon cannot execute delete_conversation()');

-- ─── …and still open to signed-in callers ─────────────────────────────

SELECT ok(has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE'),
  'authenticated can execute is_admin()');
SELECT ok(has_function_privilege('authenticated', 'public.is_blocked_by(uuid)', 'EXECUTE'),
  'authenticated can execute is_blocked_by()');
SELECT ok(has_function_privilege('authenticated', 'public.delete_chat_history(uuid, uuid)', 'EXECUTE'),
  'authenticated can execute delete_chat_history()');
SELECT ok(has_function_privilege('authenticated', 'public.delete_conversation(uuid, uuid)', 'EXECUTE'),
  'authenticated can execute delete_conversation()');

-- ─── Anonymous on purpose ─────────────────────────────────────────────

SELECT ok(has_function_privilege('anon', 'public.owns_profile(uuid)', 'EXECUTE'),
  'anon can execute owns_profile(): the scan insert policy evaluates it for anonymous scans');
SELECT ok(has_function_privilege('anon', 'public.get_email_by_username(text)', 'EXECUTE'),
  'anon can execute get_email_by_username(): sign-in by username');
SELECT ok(has_function_privilege('anon', 'public.resolve_tag(text)', 'EXECUTE'),
  'anon can execute resolve_tag(): a stranger resolving a scanned tag');
SELECT ok(has_function_privilege('anon', 'public.tag_accepts_scans(uuid)', 'EXECUTE'),
  'anon can execute tag_accepts_scans(): the scan insert policy evaluates it for anonymous scans');
SELECT ok(has_function_privilege('anon', 'public.scan_history(uuid)', 'EXECUTE'),
  'anon can execute scan_history(): a public history is public, and it answers nothing for a private one (ONE-35)');

-- ─── Revoked by name elsewhere, and still so ──────────────────────────

SELECT ok(NOT has_function_privilege('anon', 'public.create_profile(text, text, text, text)', 'EXECUTE'),
  'anon cannot execute create_profile() (ONE-80)');
SELECT ok(NOT has_function_privilege('anon', 'public.tag_scan_counts(uuid)', 'EXECUTE'),
  'anon cannot execute tag_scan_counts() (ONE-82)');
SELECT ok(NOT has_function_privilege('anon', 'public.is_project_contributor(uuid)', 'EXECUTE'),
  'anon cannot execute is_project_contributor() (ONE-38)');
SELECT ok(has_function_privilege('authenticated', 'public.is_project_contributor(uuid)', 'EXECUTE'),
  'authenticated can execute is_project_contributor(): the private-project read policy calls it');
SELECT ok(NOT has_function_privilege('anon', 'public.explore_items(double precision, text, integer, text)', 'EXECUTE'),
  'anon cannot execute explore_items() (ONE-47)');

SELECT ok(NOT has_function_privilege('anon', 'public.search_tsquery(text)', 'EXECUTE'),
  'anon cannot execute search_tsquery() (ONE-48)');
SELECT ok(NOT has_function_privilege('anon', 'public.hidden_by_block(uuid)', 'EXECUTE'),
  'anon cannot execute hidden_by_block() (ONE-48)');
SELECT ok(NOT has_function_privilege('anon', 'public.search_profiles(text, integer)', 'EXECUTE'),
  'anon cannot execute search_profiles() (ONE-48)');
SELECT ok(NOT has_function_privilege('anon', 'public.search_posts(text, integer)', 'EXECUTE'),
  'anon cannot execute search_posts() (ONE-48)');
SELECT ok(NOT has_function_privilege('anon', 'public.search_products(text, text, integer)', 'EXECUTE'),
  'anon cannot execute search_products() (ONE-48)');
SELECT ok(NOT has_function_privilege('anon', 'public.search_projects(text, text, integer, boolean)', 'EXECUTE'),
  'anon cannot execute search_projects() (ONE-48)');
SELECT ok(NOT has_function_privilege('anon', 'public.embedded_tag_destination_owner(uuid, uuid, uuid)', 'EXECUTE'),
  'anon cannot execute embedded_tag_destination_owner() (ONE-93)');

SELECT ok(NOT has_function_privilege('anon', 'public.approve_follow_request(uuid)', 'EXECUTE'),
  'anon cannot execute approve_follow_request() (ONE-63)');
SELECT ok(has_function_privilege('authenticated', 'public.approve_follow_request(uuid)', 'EXECUTE'),
  'authenticated can execute approve_follow_request(): the owner approving a request');

SELECT ok(NOT has_function_privilege('authenticated', 'public.rebuild_explore_scores()', 'EXECUTE'),
  'authenticated cannot execute rebuild_explore_scores() (ONE-104)');
SELECT ok(NOT has_function_privilege('anon', 'public.rebuild_explore_scores()', 'EXECUTE'),
  'anon cannot execute rebuild_explore_scores() (ONE-104)');

SELECT ok(NOT has_function_privilege('authenticated', 'public.request_push(text, uuid)', 'EXECUTE'),
  'authenticated cannot execute request_push() (ONE-103)');
SELECT ok(NOT has_function_privilege('anon', 'public.request_push(text, uuid)', 'EXECUTE'),
  'anon cannot execute request_push() (ONE-103)');

SELECT ok(NOT has_function_privilege('anon', 'public.feed_posts(uuid, timestamptz, text, integer, uuid)', 'EXECUTE'),
  'anon cannot execute feed_posts() (ONE-106)');
SELECT ok(NOT has_function_privilege('anon', 'public.reel_stories(uuid, timestamptz)', 'EXECUTE'),
  'anon cannot execute reel_stories() (ONE-106)');
SELECT ok(NOT has_function_privilege('anon', 'public.chat_list(uuid)', 'EXECUTE'),
  'anon cannot execute chat_list() (ONE-110)');
SELECT ok(NOT has_function_privilege('anon', 'public.blocked_profiles(uuid)', 'EXECUTE'),
  'anon cannot execute blocked_profiles() (ONE-106)');
SELECT ok(NOT has_function_privilege('anon', 'public.accounts_for_usernames(text[])', 'EXECUTE'),
  'anon cannot execute accounts_for_usernames() (ONE-106)');
SELECT ok(NOT has_function_privilege('anon', 'public.suggested_profiles(uuid, integer)', 'EXECUTE'),
  'anon cannot execute suggested_profiles() (ONE-106)');

SELECT ok(NOT has_function_privilege('anon', 'public.hidden_profile_ids()', 'EXECUTE'),
  'anon cannot execute hidden_profile_ids() (ONE-108)');
SELECT ok(NOT has_function_privilege('anon', 'public.post_hidden_by_block(uuid)', 'EXECUTE'),
  'anon cannot execute post_hidden_by_block() (ONE-108)');
SELECT ok(NOT has_function_privilege('anon', 'public.story_hidden_by_block(uuid)', 'EXECUTE'),
  'anon cannot execute story_hidden_by_block() (ONE-108)');
SELECT ok(NOT has_function_privilege('anon', 'public.comment_hidden_by_block(uuid)', 'EXECUTE'),
  'anon cannot execute comment_hidden_by_block() (ONE-108)');

SELECT ok(NOT has_function_privilege('authenticated', 'public.blocked_between(uuid, uuid)', 'EXECUTE'),
  'authenticated cannot execute blocked_between() (ONE-107)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.notify(text, uuid, uuid, uuid, uuid, text)', 'EXECUTE'),
  'authenticated cannot execute notify() (ONE-107)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.notify_mentions(text, uuid, uuid, uuid)', 'EXECUTE'),
  'authenticated cannot execute notify_mentions() (ONE-107)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.thread_comment()', 'EXECUTE'),
  'authenticated cannot execute thread_comment(), a trigger');

SELECT ok(NOT has_function_privilege('anon', 'public.messages_thread(uuid, uuid, timestamptz, uuid, integer)', 'EXECUTE'),
  'anon cannot execute messages_thread() (ONE-110)');
SELECT ok(NOT has_function_privilege('anon', 'public.following_usernames(uuid)', 'EXECUTE'),
  'anon cannot execute following_usernames() (ONE-110)');
SELECT ok(NOT has_function_privilege('anon', 'public.requested_usernames(uuid)', 'EXECUTE'),
  'anon cannot execute requested_usernames() (ONE-110)');

SELECT ok(NOT has_function_privilege('anon', 'public.register_push_token(text, text)', 'EXECUTE'),
  'anon cannot execute register_push_token() (ONE-112)');

SELECT ok(NOT has_function_privilege('anon', 'public.feed_candidates(uuid, timestamptz, uuid, text, integer)', 'EXECUTE'),
  'anon cannot execute feed_candidates() (ONE-116)');

-- ─── Unlisted projects (ONE-137) ──────────────────────────────────────

SELECT ok(NOT has_function_privilege('anon', 'public.grant_project_tag_access(text, uuid)', 'EXECUTE'),
  'anon cannot execute grant_project_tag_access(): a grant is a signed-in profile''s');
SELECT ok(has_function_privilege('authenticated', 'public.grant_project_tag_access(text, uuid)', 'EXECUTE'),
  'authenticated can execute grant_project_tag_access(): opening an unlisted project''s tag');
SELECT ok(NOT has_function_privilege('anon', 'public.can_read_unlisted_project(uuid)', 'EXECUTE'),
  'anon cannot execute can_read_unlisted_project()');
SELECT ok(has_function_privilege('authenticated', 'public.can_read_unlisted_project(uuid)', 'EXECUTE'),
  'authenticated can execute can_read_unlisted_project(): the unlisted read policy calls it');

-- ─── Project details (ONE-140) ────────────────────────────────────────

SELECT ok(NOT has_function_privilege('anon', 'public.is_calendar_date(text)', 'EXECUTE'),
  'anon cannot execute is_calendar_date(): only the signed-in write details');
SELECT ok(has_function_privilege('authenticated', 'public.is_calendar_date(text)', 'EXECUTE'),
  'authenticated can execute is_calendar_date(): the date check on project_details calls it');

-- ─── Project log (ONE-141) ────────────────────────────────────────────

SELECT ok(NOT has_function_privilege('anon', 'public.remove_me_from_log_entry(uuid)', 'EXECUTE'),
  'anon cannot execute remove_me_from_log_entry(): a name is a signed-in profile''s to remove');
SELECT ok(has_function_privilege('authenticated', 'public.remove_me_from_log_entry(uuid)', 'EXECUTE'),
  'authenticated can execute remove_me_from_log_entry(): the profile named on an entry takes its name off');

-- ─── Writing to someone else's log (ONE-143) ──────────────────────────

SELECT ok(NOT has_function_privilege('anon', 'public.log_entry_status_for(uuid, uuid)', 'EXECUTE'),
  'anon cannot execute log_entry_status_for(): it answers only about the caller''s own profiles');
SELECT ok(has_function_privilege('authenticated', 'public.log_entry_status_for(uuid, uuid)', 'EXECUTE'),
  'authenticated can execute log_entry_status_for(): the log insert policy calls it, and the app asks it what to offer');
SELECT ok(NOT has_function_privilege('anon', 'public.approve_log_entry(uuid)', 'EXECUTE'),
  'anon cannot execute approve_log_entry()');
SELECT ok(has_function_privilege('authenticated', 'public.approve_log_entry(uuid)', 'EXECUTE'),
  'authenticated can execute approve_log_entry(): the project''s owner publishes a proposal');

SELECT * FROM finish();
ROLLBACK;
