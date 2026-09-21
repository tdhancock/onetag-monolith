-- OneTag — RPC functions required by the mobile app

-- 1. get_email_by_username: resolve username -> email for the login-by-username flow.
--    Must be callable before authentication, so it is granted to anon.
--    Note: this lets anyone map a username to an email address.
CREATE OR REPLACE FUNCTION public.get_email_by_username(p_username TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.email::text
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE lower(p.username) = lower(p_username)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_email_by_username(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_by_username(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_email_by_username(TEXT) TO anon;

-- 2. delete_chat_history: remove message thread between two users.
--    The caller must be one of the two participants.
CREATE OR REPLACE FUNCTION public.delete_chat_history(user_id_1 UUID, user_id_2 UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR (SELECT auth.uid()) NOT IN (user_id_1, user_id_2) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.messages
  WHERE (sender_id = user_id_1 AND receiver_id = user_id_2)
     OR (sender_id = user_id_2 AND receiver_id = user_id_1);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_chat_history(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_chat_history(UUID, UUID) TO authenticated;

-- 3. delete_conversation: same operation, different parameter names (used by mobile).
CREATE OR REPLACE FUNCTION public.delete_conversation(user1 UUID, user2 UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR (SELECT auth.uid()) NOT IN (user1, user2) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.messages
  WHERE (sender_id = user1 AND receiver_id = user2)
     OR (sender_id = user2 AND receiver_id = user1);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_conversation(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_conversation(UUID, UUID) TO authenticated;
