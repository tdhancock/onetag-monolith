-- Scan History: private by default, public only by choice (ONE-35).
--
-- A profile's Scan History is the log of every Tag it has scanned — a record
-- of physical places someone has been: a showroom, a house, a car at a show.
-- It is private unless its profile deliberately opens it. No migration may
-- open it for anyone: the column defaults to false, and existing profiles
-- get that default.
--
-- The database enforces the choice, not the client. A scan row is readable
-- by its scanner (ONE-27) and, now, by anyone while the scanner's history is
-- public. Closing it is immediate and retroactive: the check reads the live
-- column, so every scan hides again at once, with nothing to backfill.
--
-- A tag's owner still sees how many scans and when, never who (ONE-82): a
-- private history stays private from the owners of the tags in it.

ALTER TABLE public.profiles
    ADD COLUMN scan_history_public BOOLEAN NOT NULL DEFAULT false;

CREATE POLICY "Public scan histories are viewable by everyone" ON public.scans
    FOR SELECT TO anon, authenticated
    USING (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = scans.scanner_profile_id AND p.scan_history_public
    ));

-- ─── Reading a history ────────────────────────────────────────────────
--
-- A scanner cannot read the tags they scanned: tags are owner-only (ONE-82).
-- So a history is read through this: one row per destination scanned, with
-- how many times and when last — the display collapses repeats, the data
-- keeps every scan, which the owner's counts need.
--
-- It returns only where each tag led: the destination's kind, id and name,
-- and a profile's handle to route by. Never the tag's own name or note,
-- which are its owner's, and never the tag's id.
--
-- Rows only for a history the caller may read: their own profile's, or one
-- made public. A private project in a history is shown only to someone who
-- can see that project — its owner and its contributors — as RLS would.
--
-- SECURITY DEFINER to read the tags; open to anon, since a public history is
-- public.

CREATE OR REPLACE FUNCTION public.scan_history(p_profile_id UUID)
RETURNS TABLE (
    dest_kind TEXT,
    dest_id UUID,
    dest_name TEXT,
    dest_username TEXT,
    scan_count BIGINT,
    last_scanned_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    h.dest_kind,
    h.dest_id,
    h.dest_name,
    h.dest_username,
    count(*),
    max(h.scanned_at)
  FROM (
    SELECT
      s.scanned_at,
      CASE
        WHEN t.dest_profile_id IS NOT NULL THEN 'profile'
        WHEN t.dest_product_id IS NOT NULL THEN 'product'
        ELSE 'project'
      END AS dest_kind,
      coalesce(t.dest_profile_id, t.dest_product_id, t.dest_project_id) AS dest_id,
      CASE
        WHEN t.dest_profile_id IS NOT NULL THEN coalesce(nullif(pr.full_name, ''), pr.username)
        WHEN t.dest_product_id IS NOT NULL THEN pd.name
        ELSE pj.name
      END AS dest_name,
      pr.username AS dest_username
    FROM public.scans s
    JOIN public.tags t ON t.id = s.tag_id
    LEFT JOIN public.profiles pr ON pr.id = t.dest_profile_id
    LEFT JOIN public.products pd ON pd.id = t.dest_product_id
    LEFT JOIN public.projects pj ON pj.id = t.dest_project_id
    WHERE s.scanner_profile_id = p_profile_id
      AND (
        public.owns_profile(p_profile_id)
        OR EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = p_profile_id AND me.scan_history_public)
      )
      AND (
        t.dest_project_id IS NULL
        OR pj.is_public
        OR public.owns_profile(pj.owner_profile_id)
        OR public.is_project_contributor(pj.id)
      )
  ) h
  GROUP BY h.dest_kind, h.dest_id, h.dest_name, h.dest_username
  ORDER BY max(h.scanned_at) DESC;
$$;

REVOKE ALL ON FUNCTION public.scan_history(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scan_history(UUID) TO anon, authenticated;
