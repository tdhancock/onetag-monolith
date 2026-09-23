-- Blocking, enforced by the database rather than by the client.
--
-- Blocking used to be a Set of usernames in AsyncStorage: it hid people from
-- the lists this device rendered, survived nothing, reached no other device,
-- and stopped a blocked account from doing precisely nothing. This table and
-- the policies below make a block mean what people assume it means.
--
-- Keyed on auth.users, not on profiles: this lands before the multi-profile
-- work (ONE-21), and a block is a decision by a person about a person, not by
-- one of their profiles about one of yours. ONE-21 migrates it with the rest.

CREATE TABLE public.blocks (
    blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CONSTRAINT blocks_no_self_block CHECK (blocker_id <> blocked_id)
);

-- The primary key already indexes (blocker_id, blocked_id), which serves
-- "who have I blocked". The enforcement policies below read the other way —
-- "has this person blocked me" — so that direction needs its own index.
CREATE INDEX idx_blocks_blocked ON public.blocks (blocked_id);

ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;

-- A block row belongs to the person who made it, and to nobody else.
-- Deliberately no policy letting the blocked party read rows naming them:
-- being able to see who blocked you is both an information leak and an
-- invitation to retaliate.
CREATE POLICY "Users can view own blocks" ON public.blocks
    FOR SELECT TO authenticated USING (blocker_id = (SELECT auth.uid()));
CREATE POLICY "Users can block as themselves" ON public.blocks
    FOR INSERT TO authenticated WITH CHECK (blocker_id = (SELECT auth.uid()));
CREATE POLICY "Users can remove own blocks" ON public.blocks
    FOR DELETE TO authenticated USING (blocker_id = (SELECT auth.uid()));

-- ═══════════════════════════════════════
-- Enforcement
-- ═══════════════════════════════════════
--
-- SECURITY DEFINER because the check runs against rows the caller is not
-- allowed to read: "has A blocked me" must be answerable inside a policy
-- without making the answer readable to the person asking.

CREATE OR REPLACE FUNCTION public.is_blocked_by(target UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocks
    WHERE blocker_id = target AND blocked_id = (SELECT auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.is_blocked_by(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_blocked_by(UUID) TO authenticated;

-- A blocked sender cannot message the person who blocked them. Replaces the
-- insert policy rather than adding to it: two permissive policies on the same
-- command are OR'd together, so an additional one would permit everything the
-- original did.
DROP POLICY "Users can send messages as themselves" ON public.messages;
CREATE POLICY "Users can send messages as themselves" ON public.messages
    FOR INSERT TO authenticated
    WITH CHECK (
        sender_id = (SELECT auth.uid())
        AND NOT public.is_blocked_by(receiver_id)
    );

-- Likewise a blocked account cannot comment on the blocker's posts.
DROP POLICY "Users can comment as themselves" ON public.comments;
CREATE POLICY "Users can comment as themselves" ON public.comments
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND NOT EXISTS (
            SELECT 1 FROM public.posts p
            WHERE p.id = comments.post_id
              AND public.is_blocked_by(p.user_id)
        )
    );

-- Post *visibility* is deliberately not enforced here. Hiding a blocker's
-- posts from the blocked account changes feed semantics and interacts with
-- the is_private policy above; the client-side filter stays until that is
-- decided on its own terms (ONE-54 notes it as a follow-up).
