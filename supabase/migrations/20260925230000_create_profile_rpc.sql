-- Create a profile and its business row in one transaction (ONE-80).
--
-- Adding a business profile (ONE-26) took two client requests: the profiles
-- row, then its business_profiles row. They could not be atomic, so a failed
-- second request left a business profile with no extension row — survivable,
-- since saving the business fields upserts it, but a state the schema is
-- meant to rule out. One function call is one transaction: both rows exist,
-- or neither does.
--
-- SECURITY INVOKER, the default, on purpose. It runs as the caller, so the
-- profiles insert policy, the one-of-each index and ONE-23's type guard apply
-- exactly as they did to the direct inserts. The owner is always auth.uid(),
-- never a parameter, so nobody creates a profile for another account.
--
-- Unique violations are not caught. The client reads the constraint name —
-- profiles_username_lower_key or profiles_one_per_type — out of the error
-- message to tell a taken handle from a taken kind (createProfileFailureFor).

CREATE OR REPLACE FUNCTION public.create_profile(
    p_profile_type TEXT,
    p_username TEXT,
    p_full_name TEXT,
    p_bio TEXT DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  account UUID := auth.uid();
  created public.profiles;
BEGIN
  IF account IS NULL THEN
    RAISE EXCEPTION 'create_profile needs a signed-in account'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.profiles (user_id, profile_type, username, full_name, bio)
  VALUES (account, p_profile_type, p_username, p_full_name, p_bio)
  RETURNING * INTO created;

  IF p_profile_type = 'business' THEN
    INSERT INTO public.business_profiles (profile_id) VALUES (created.id);
  END IF;

  RETURN created;
END;
$$;

-- Revoked from anon by name as well as PUBLIC: Supabase's default privileges
-- grant EXECUTE on every new public function to anon directly, so revoking
-- PUBLIC alone leaves anonymous callers able to run it.
REVOKE ALL ON FUNCTION public.create_profile(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_profile(TEXT, TEXT, TEXT, TEXT) TO authenticated;
