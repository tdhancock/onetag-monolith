-- Revoke anon's EXECUTE by name on functions only signed-in callers run (ONE-85).
--
-- These four were written with the repo's old pattern:
--
--   REVOKE ALL ON FUNCTION public.f(...) FROM PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.f(...) TO authenticated;
--
-- On Supabase that does not refuse anon: the default privileges grant EXECUTE
-- on every new public function to anon (and authenticated, service_role)
-- directly, not through PUBLIC, so revoking PUBLIC leaves anon's own grant in
-- place. None of the four is an exposure today — each checks auth.uid(), or
-- returns false with no session — but the next function to copy the pattern
-- and rely on the grant alone would be.
--
-- Nothing anonymous reaches them: every policy that calls is_admin() or
-- is_blocked_by() is TO authenticated, protect_profile_verified calls
-- is_admin() only on a profile update anon's RLS never lets through, and the
-- app calls all four only with a session.
--
-- Left granted to anon on purpose: owns_profile (policies anonymous scans
-- evaluate), get_email_by_username (sign-in by username), resolve_tag and
-- tag_accepts_scans (a stranger scanning a sticker). The pgTAP suite pins
-- both lists.

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_blocked_by(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_chat_history(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_conversation(UUID, UUID) FROM PUBLIC, anon;

-- Unchanged, restated so the file reads whole.
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_blocked_by(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_chat_history(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_conversation(UUID, UUID) TO authenticated;
