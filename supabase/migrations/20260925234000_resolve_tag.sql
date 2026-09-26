-- Tag Resolution in one read (ONE-30).
--
-- The resolution route has to tell three cases apart: a code that does not
-- exist, a tag its owner has paused, and a live tag with somewhere to go.
--
-- The tags table is readable by its owners only (ONE-82), so this function
-- is how everyone else reads a tag — a stranger scanning a sticker included.
-- SECURITY DEFINER, and it says no more than resolution needs: for a paused
-- tag, only that it is paused, never where it points; for an active tag, its
-- id (to record the Scan against) and its destination, with the destination
-- profile's handle so the app can route without a second round trip. Never
-- the note, never the owner, and only ever one tag, by its exact code.
--
-- M5 adds product and project destinations to tags; it must add them here
-- too, or resolution will report their tags as having nowhere to go.

CREATE OR REPLACE FUNCTION public.resolve_tag(p_short_code TEXT)
RETURNS TABLE (
    tag_id UUID,
    active BOOLEAN,
    dest_profile_id UUID,
    dest_profile_username TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    CASE WHEN t.active THEN t.id END,
    t.active,
    CASE WHEN t.active THEN t.dest_profile_id END,
    CASE WHEN t.active THEN p.username END
  FROM public.tags t
  LEFT JOIN public.profiles p ON p.id = t.dest_profile_id
  WHERE t.short_code = p_short_code;
$$;

-- Resolution must work without an account: a stranger scanning a sticker.
REVOKE ALL ON FUNCTION public.resolve_tag(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_tag(TEXT) TO anon, authenticated;
