-- Tag Resolution in one read (ONE-30).
--
-- The resolution route has to tell three cases apart: a code that does not
-- exist, a tag its owner has paused, and a live tag with somewhere to go. The
-- tags table's RLS (ONE-27) shows a stranger active tags only, so to the
-- client a paused tag looks exactly like a code that does not exist — and the
-- two need different screens.
--
-- This function answers for any code, and says no more than resolution
-- needs: for a paused tag, only that it is paused — never where it points,
-- which the table's RLS keeps from strangers on purpose. For an active tag,
-- its id (to record the Scan against) and its destination, with the
-- destination profile's handle so the app can route without a second round
-- trip. SECURITY DEFINER for the paused case; the result is the same RLS'd
-- view the table gives for an active tag.
--
-- M5 adds product and project destinations to tags; it must add them here
-- too, or resolution will report their tags as having nowhere to go.

CREATE OR REPLACE FUNCTION public.resolve_tag(p_short_code TEXT)
RETURNS TABLE (
    tag_id UUID,
    active BOOLEAN,
    dest_profile_id UUID,
    dest_profile_username TEXT,
    dest_post_id UUID
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
    CASE WHEN t.active THEN p.username END,
    CASE WHEN t.active THEN t.dest_post_id END
  FROM public.tags t
  LEFT JOIN public.profiles p ON p.id = t.dest_profile_id
  WHERE t.short_code = p_short_code;
$$;

-- Resolution must work without an account: a stranger scanning a sticker.
REVOKE ALL ON FUNCTION public.resolve_tag(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_tag(TEXT) TO anon, authenticated;
