-- Tags and Scans (ONE-27).
--
-- A Tag is a portal to exactly one Destination; a Scan is the record of a Tag
-- being read. Additive: nothing reads either table until the resolution route
-- that ships with it (ONE-30) does.
--
-- Destinations are real foreign keys — one nullable column per destination
-- kind, with a check that exactly one is set — not the reference handoff's
-- `dest_type` / `dest_id` pair, which can carry no foreign key and so lets a
-- deleted destination leave tags pointing at nothing. The same reasoning as
-- the locked identity decision. Of the four Destination kinds — Business
-- Profile, Individual Profile, Product, Project — only profiles exist today,
-- both kinds in the one profiles table; M5 adds product and project columns
-- to this table. A post is not a Destination (ONE-83).
--
-- Embedded Tag positions (tag_x_pct / tag_y_pct) belong to M6.

-- ─── Short codes ──────────────────────────────────────────────────────
--
-- Generated here, not on the client: uniqueness is a property of the
-- database, and a client cannot guarantee it.
--
-- Eight characters from an alphabet without 0, O, 1, I and l. Codes are
-- printed on stickers and read back by people, and glyphs that look alike
-- turn into support tickets. The alphabet is exactly lib/tagLinks.ts's
-- TAG_SHORT_CODE_ALPHABET — keep the two in step; the shape test compares
-- them.
--
-- Random bytes come from pgcrypto, not random(): a code is the only thing
-- between a stranger and a tag, so it should not be predictable. Bytes at or
-- above 228 (57 × 4) are discarded, so every character is equally likely.
--
-- SECURITY DEFINER so the collision check sees every tag, including the
-- inactive ones RLS hides from the caller. It returns nothing but a fresh
-- code, so it tells a caller nothing about anyone's tags.

CREATE OR REPLACE FUNCTION public.gen_short_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  byte_limit CONSTANT INT := 228;
  candidate TEXT;
  random_bytes BYTEA;
  b INT;
BEGIN
  -- Retry on collision. At 57^8 codes a single retry is already unlikely;
  -- ten in a row means something other than chance is wrong.
  FOR attempt IN 1..10 LOOP
    candidate := '';
    WHILE char_length(candidate) < 8 LOOP
      random_bytes := extensions.gen_random_bytes(16);
      FOR i IN 0..15 LOOP
        b := get_byte(random_bytes, i);
        IF b < byte_limit AND char_length(candidate) < 8 THEN
          candidate := candidate || substr(alphabet, (b % 57) + 1, 1);
        END IF;
      END LOOP;
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM public.tags WHERE short_code = candidate) THEN
      RETURN candidate;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'could not generate an unused short code' USING ERRCODE = '23505';
END;
$$;

-- Evaluated as the inserting role when the column default fires, so signed-in
-- callers need it. Anonymous callers never create tags. Revoked from anon by
-- name: Supabase's default privileges grant new functions to anon directly.
REVOKE ALL ON FUNCTION public.gen_short_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gen_short_code() TO authenticated;

-- ─── tags ─────────────────────────────────────────────────────────────

CREATE TABLE public.tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    tag_type TEXT NOT NULL CHECK (tag_type IN ('physical', 'digital', 'embedded')),
    -- NFC is deferred (Working Agreement), so 'qr' is the only format today.
    -- The column and its check stay so adding 'nfc' is a one-line change.
    format TEXT CHECK (format IN ('qr')),
    name TEXT,
    note TEXT,
    dest_profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    active BOOLEAN NOT NULL DEFAULT true,
    short_code TEXT NOT NULL UNIQUE DEFAULT public.gen_short_code()
        -- The shape lib/tagLinks.ts's isValidShortCode accepts, so a code the
        -- app would refuse to parse can never be issued.
        CONSTRAINT tags_short_code_shape
        CHECK (short_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{8}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Exactly one destination. With one kind today this only says a profile
    -- is set, but it is written as num_nonnulls so M5 extends it rather than
    -- replacing it. M5 MUST extend this check with the product and project
    -- destination columns, or a tag could point at a product and a profile
    -- at once.
    CONSTRAINT tags_one_destination CHECK (num_nonnulls(dest_profile_id) = 1)
);

COMMENT ON CONSTRAINT tags_one_destination ON public.tags IS
    'Exactly one destination. M5 must extend this check when it adds product and project destination columns.';

-- tags(short_code) is covered by its unique constraint.
CREATE INDEX tags_owner_profile_id ON public.tags (owner_profile_id);
-- The destination foreign key cascades, so deleting a profile looks its tags
-- up by it; without an index that is a full scan.
CREATE INDEX tags_dest_profile_id ON public.tags (dest_profile_id) WHERE dest_profile_id IS NOT NULL;

-- ─── scans ────────────────────────────────────────────────────────────

CREATE TABLE public.scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    -- Nullable on purpose: an anonymous scan — a stranger without the app
    -- scanning a sticker — is the primary case, not an edge case.
    scanner_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX scans_tag_id_scanned_at ON public.scans (tag_id, scanned_at DESC);
CREATE INDEX scans_scanner_profile_id_scanned_at ON public.scans (scanner_profile_id, scanned_at DESC);

-- ─── RLS: tags ────────────────────────────────────────────────────────
--
-- Only a tag's owner reads the table (ONE-82). Everyone else — a stranger
-- scanning a sticker included — reads a tag through public.resolve_tag(),
-- which returns only what routing needs. Direct reads would hand anyone
-- every live tag's note and owner, and let them list every tag there is.
-- M6's Embedded Tags (ONE-44) get a read of their own, following the post
-- they sit in.

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view own tags" ON public.tags
    FOR SELECT TO authenticated
    USING ((SELECT public.owns_profile(owner_profile_id)));

-- The destination must belong to the same account as the tag. Without this,
-- anyone could point a tag at someone else's profile and harvest the scans
-- attributed to it. Checked on update as well as insert, or re-pointing an
-- existing tag would get around it.
--
-- M6's Embedded Tags will point at other people's Products and Profiles from
-- inside a post; ONE-44 has to relax this for tag_type = 'embedded'.
CREATE POLICY "Users can create tags to own destinations" ON public.tags
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT public.owns_profile(owner_profile_id))
        AND (tags.dest_profile_id IS NULL OR (SELECT public.owns_profile(tags.dest_profile_id)))
    );

CREATE POLICY "Users can update own tags" ON public.tags
    FOR UPDATE TO authenticated
    USING ((SELECT public.owns_profile(owner_profile_id)))
    WITH CHECK (
        (SELECT public.owns_profile(owner_profile_id))
        AND (tags.dest_profile_id IS NULL OR (SELECT public.owns_profile(tags.dest_profile_id)))
    );

CREATE POLICY "Users can delete own tags" ON public.tags
    FOR DELETE TO authenticated
    USING ((SELECT public.owns_profile(owner_profile_id)));

-- ─── Scans: what may be recorded ──────────────────────────────────────

-- Whether a tag takes scans: it exists and is active. SECURITY DEFINER
-- because the scan insert policy runs as the scanner, who cannot read the
-- tags table (above). It answers yes or no about one tag id — an id only
-- resolve_tag hands out, and only for an active tag.
CREATE OR REPLACE FUNCTION public.tag_accepts_scans(p_tag_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.tags WHERE id = p_tag_id AND active);
$$;

REVOKE ALL ON FUNCTION public.tag_accepts_scans(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tag_accepts_scans(UUID) TO anon, authenticated;

-- A scan happens when it is recorded. The client never says when, so no
-- scan can be backdated into someone's history or an owner's counts.
CREATE OR REPLACE FUNCTION public.scans_set_scanned_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.scanned_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER scans_set_scanned_at
    BEFORE INSERT ON public.scans
    FOR EACH ROW EXECUTE FUNCTION public.scans_set_scanned_at();

-- ─── RLS: scans ───────────────────────────────────────────────────────

ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;

-- Anonymous scans must record. A scan is attributed to nobody or to a profile
-- the caller owns — never forged onto someone else — and it must be of a
-- live tag, so nobody fills the log with scans of tags that could never have
-- resolved.
--
-- Clients insert without RETURNING: anon has no SELECT on scans.
CREATE POLICY "Anyone can record a scan" ON public.scans
    FOR INSERT TO anon, authenticated
    WITH CHECK (
        (scans.scanner_profile_id IS NULL OR (SELECT public.owns_profile(scans.scanner_profile_id)))
        AND (SELECT public.tag_accepts_scans(scans.tag_id))
    );

-- A scan row is readable by its scanner alone: it is the scanner's own
-- history (Scan History, ONE-35). A tag's owner sees how many scans and
-- when, never who — see tag_scan_counts below (ONE-82).
CREATE POLICY "Scanners can view own scans" ON public.scans
    FOR SELECT TO authenticated
    USING ((SELECT public.owns_profile(scanner_profile_id)));

-- No UPDATE or DELETE policies: scans are an append-only log.

-- ─── What a tag's owner sees: how many, and when ──────────────────────
--
-- Per tag, for one profile's tags: how many scans it has had and when it was
-- last scanned. Never who — a scan records where someone has been, and Scan
-- History is private by default (ONE-82). The caller must own the profile;
-- for anyone else this returns nothing.
CREATE OR REPLACE FUNCTION public.tag_scan_counts(p_owner_profile_id UUID)
RETURNS TABLE (tag_id UUID, scan_count BIGINT, last_scanned_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id, count(s.id), max(s.scanned_at)
  FROM public.tags t
  LEFT JOIN public.scans s ON s.tag_id = t.id
  WHERE t.owner_profile_id = p_owner_profile_id
    AND public.owns_profile(p_owner_profile_id)
  GROUP BY t.id;
$$;

REVOKE ALL ON FUNCTION public.tag_scan_counts(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tag_scan_counts(UUID) TO authenticated;
