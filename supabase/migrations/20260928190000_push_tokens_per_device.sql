-- A push token for each device, not each account (ONE-112).
--
-- push_tokens had UNIQUE (user_id): one token an account, replaced by every
-- sign-in, so only the device signed in last got pushes. A token names one
-- device, so the token is the key now. An account keeps a row for each device
-- it is signed in on, and send-push already sends to every one of them.
--
-- A device signing in to another account moves its row to that account,
-- through register_push_token(). It runs as the database because the row may
-- still be the previous account's — signed out offline, say — and RLS rightly
-- hides that row from the new one. Signing out deletes the device's own row,
-- under the existing policy (services/notifications.ts).

ALTER TABLE public.push_tokens DROP CONSTRAINT IF EXISTS push_tokens_user_id_key;

-- A device that changed accounts can hold a row under each: keep the newest.
DELETE FROM public.push_tokens a
USING public.push_tokens b
WHERE a.token = b.token
  AND (coalesce(a.updated_at, a.created_at, '-infinity'), a.id)
    < (coalesce(b.updated_at, b.created_at, '-infinity'), b.id);

ALTER TABLE public.push_tokens ADD CONSTRAINT push_tokens_token_key UNIQUE (token);

-- ─── Registering this device for the signed-in account ────────────────

CREATE OR REPLACE FUNCTION public.register_push_token(p_token TEXT, p_platform TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Sign in to register for pushes.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_token), '') = '' THEN
    RAISE EXCEPTION 'No push token given.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.push_tokens (user_id, token, platform, is_active, updated_at)
  VALUES ((SELECT auth.uid()), p_token, p_platform, true, now())
  ON CONFLICT (token) DO UPDATE
    SET user_id = excluded.user_id,
        platform = excluded.platform,
        is_active = true,
        updated_at = excluded.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.register_push_token(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) TO authenticated;
