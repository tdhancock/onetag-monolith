-- Contributors write to a project's log, and businesses who scanned it propose
-- entries (ONE-143).
--
-- Decided 2026-10-07: both, now. A Linked Contributor's entry is published at
-- once. A business that scanned the item's tag, and isn't Linked, proposes an
-- entry its owner approves: the technician scans the sticker on the furnace
-- and logs the visit, the business gets proof of service, and the owner a
-- record that keeps itself. The owner hears of either.
--
--   author_profile_id   who wrote the entry: the owner, a Contributor, or a
--                       business proposing one. Existing entries are their
--                       owner's.
--   status              published, or proposed until the owner approves it
--
-- An entry's author is one of the writer's own profiles, and what it may be
-- is log_entry_status_for's to say: published for the project's owner or a
-- Contributor, proposed for a business whose account scanned an active tag
-- pointing at the project. A proposed entry is read by the owner and its
-- author alone. Only the owner publishes one, through approve_log_entry,
-- which Links its author as a Contributor; declining deletes it.

ALTER TABLE public.project_log_entries
    ADD COLUMN author_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'proposed'));

UPDATE public.project_log_entries e
SET author_profile_id = p.owner_profile_id
FROM public.projects p
WHERE p.id = e.project_id;

-- A Contributor's entry names its author as who did it, so deleting that
-- profile sets two keys null on the one row, one update after the other, and
-- Postgres checks every key again on a row this transaction already changed.
-- When the project's owner goes in the same delete (one account holding both
-- profiles), the project can be gone before the entry's own cascade reaches
-- it, and that check of project_id stopped the account's deletion. Checked at
-- commit, the entry has gone with its project by then. The cascade still runs
-- at once, and a project that isn't there is still refused.
ALTER TABLE public.project_log_entries
    ALTER CONSTRAINT project_log_entries_project_id_fkey DEFERRABLE INITIALLY DEFERRED;

-- An author's entries, and its delete's SET NULL.
CREATE INDEX project_log_entries_author_profile_id
    ON public.project_log_entries (author_profile_id) WHERE author_profile_id IS NOT NULL;

-- An entry written without an author is its project owner's, as every entry
-- was before. Nobody else gains by leaving it out: the insert policy still
-- needs the writer to own the author.
CREATE OR REPLACE FUNCTION public.default_log_entry_author()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.author_profile_id IS NULL THEN
    SELECT owner_profile_id INTO NEW.author_profile_id FROM public.projects WHERE id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;

-- A trigger function, never called directly.
REVOKE ALL ON FUNCTION public.default_log_entry_author() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER project_log_entries_default_author
    BEFORE INSERT ON public.project_log_entries
    FOR EACH ROW EXECUTE FUNCTION public.default_log_entry_author();

-- ─── What an entry by a profile would be ──────────────────────────────
--
-- 'published' for the project's owner or one of its Contributors, 'proposed'
-- for a Business Profile whose account has a Scan of an active tag pointing
-- at the project (and no block between it and the owner), and null for
-- anyone else. SECURITY DEFINER because scans are readable only by their
-- scanner, and a hidden contributor link only by its two ends. It answers
-- only about the caller's own profiles, so it says nothing of anyone else's
-- scans or links. The app asks it whether to offer Add to log or Propose a
-- log entry; the insert policy holds every entry to its answer.

CREATE OR REPLACE FUNCTION public.log_entry_status_for(p_project_id UUID, p_author_profile_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  project_owner UUID;
  author_type TEXT;
  author_account UUID;
BEGIN
  IF p_project_id IS NULL OR p_author_profile_id IS NULL OR NOT public.owns_profile(p_author_profile_id) THEN
    RETURN NULL;
  END IF;

  SELECT owner_profile_id INTO project_owner FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF p_author_profile_id = project_owner OR EXISTS (
    SELECT 1 FROM public.contributors c
    WHERE c.project_id = p_project_id AND c.contributor_profile_id = p_author_profile_id
  ) THEN
    RETURN 'published';
  END IF;

  SELECT profile_type, user_id INTO author_type, author_account FROM public.profiles WHERE id = p_author_profile_id;
  IF author_type IS DISTINCT FROM 'business' OR public.blocked_between(p_author_profile_id, project_owner) THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.scans s
    JOIN public.tags t ON t.id = s.tag_id
    JOIN public.profiles scanner ON scanner.id = s.scanner_profile_id
    WHERE t.active AND t.dest_project_id = p_project_id AND scanner.user_id = author_account
  ) THEN
    RETURN 'proposed';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_entry_status_for(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_entry_status_for(UUID, UUID) TO authenticated;

-- ─── Read ─────────────────────────────────────────────────────────────

DROP POLICY "Log entries are viewable with their project" ON public.project_log_entries;

CREATE POLICY "Published log entries are viewable with their project" ON public.project_log_entries
    FOR SELECT TO anon, authenticated
    USING (status = 'published' AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_log_entries.project_id));

CREATE POLICY "Proposed log entries are viewable by the owner and the author" ON public.project_log_entries
    FOR SELECT TO authenticated
    USING (
        status = 'proposed'
        AND (
            (SELECT public.owns_profile(author_profile_id))
            OR EXISTS (
                SELECT 1 FROM public.projects p
                WHERE p.id = project_log_entries.project_id AND (SELECT public.owns_profile(p.owner_profile_id))
            )
        )
    );

-- ─── Write ────────────────────────────────────────────────────────────
--
-- Insert: as one of your own profiles, and as what log_entry_status_for says
-- that profile's entry is. Update and delete: the owner, any entry; an author,
-- their own, while they may still write to the log. The trigger below keeps
-- the status, author and project honest.

DROP POLICY "Project owners can add log entries" ON public.project_log_entries;
DROP POLICY "Project owners can change log entries" ON public.project_log_entries;
DROP POLICY "Project owners can delete log entries" ON public.project_log_entries;

CREATE POLICY "Owners, Contributors and scanning businesses write log entries" ON public.project_log_entries
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT public.owns_profile(author_profile_id))
        AND status = public.log_entry_status_for(project_id, author_profile_id)
    );

CREATE POLICY "Owners and authors change log entries" ON public.project_log_entries
    FOR UPDATE TO authenticated
    USING (
        (SELECT public.owns_profile(author_profile_id))
        OR EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_log_entries.project_id AND (SELECT public.owns_profile(p.owner_profile_id))
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_log_entries.project_id AND (SELECT public.owns_profile(p.owner_profile_id))
        )
        OR (
            (SELECT public.owns_profile(author_profile_id))
            AND public.log_entry_status_for(project_id, author_profile_id) IS NOT NULL
        )
    );

CREATE POLICY "Owners and authors delete log entries" ON public.project_log_entries
    FOR DELETE TO authenticated
    USING (
        (SELECT public.owns_profile(author_profile_id))
        OR EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_log_entries.project_id AND (SELECT public.owns_profile(p.owner_profile_id))
        )
    );

-- ─── Status, author and project ───────────────────────────────────────
--
-- Only the project's owner moves an entry from proposed to published, and
-- nothing moves one back. An entry stays on its project, and keeps its
-- author: only the author's own deletion clears it (the foreign key's SET
-- NULL, which is an update too).

CREATE OR REPLACE FUNCTION public.check_log_entry_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'a log entry stays on its project' USING ERRCODE = '42501';
  END IF;
  IF NEW.author_profile_id IS DISTINCT FROM OLD.author_profile_id AND NEW.author_profile_id IS NOT NULL THEN
    RAISE EXCEPTION 'a log entry keeps its author' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status <> 'published' OR NOT EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND public.owns_profile(p.owner_profile_id)
    ) THEN
      RAISE EXCEPTION 'only the project''s owner publishes a proposed log entry' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- A trigger function, never called directly.
REVOKE ALL ON FUNCTION public.check_log_entry_change() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER project_log_entries_check_change
    BEFORE UPDATE ON public.project_log_entries
    FOR EACH ROW EXECUTE FUNCTION public.check_log_entry_change();

-- ─── Approving ────────────────────────────────────────────────────────
--
-- The owner publishes a proposed entry, and its author is Linked as a
-- Contributor if it isn't one: the business that serviced the furnace is one
-- tap from it from then on. True when an entry was published; false when it
-- already was. Anyone but the owner is refused, as is an entry that doesn't
-- exist, so a refusal never says which.

CREATE OR REPLACE FUNCTION public.approve_log_entry(p_entry_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  entry RECORD;
BEGIN
  SELECT e.status, e.author_profile_id, e.project_id, p.owner_profile_id
  INTO entry
  FROM public.project_log_entries e
  JOIN public.projects p ON p.id = e.project_id
  WHERE e.id = p_entry_id
  FOR UPDATE OF e;

  IF NOT FOUND OR NOT public.owns_profile(entry.owner_profile_id) THEN
    RAISE EXCEPTION 'only the project''s owner approves a log entry' USING ERRCODE = '42501';
  END IF;
  IF entry.status = 'published' THEN
    RETURN false;
  END IF;

  UPDATE public.project_log_entries SET status = 'published' WHERE id = p_entry_id;
  IF entry.author_profile_id IS NOT NULL AND entry.author_profile_id <> entry.owner_profile_id THEN
    INSERT INTO public.contributors (project_id, contributor_profile_id)
    VALUES (entry.project_id, entry.author_profile_id)
    ON CONFLICT (project_id, contributor_profile_id) DO NOTHING;
  END IF;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_log_entry(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_log_entry(UUID) TO authenticated;

-- ─── Photos ───────────────────────────────────────────────────────────
--
-- An entry's photos are its author's to add, move and remove as well as the
-- owner's. They are read with their entry, as before, so a proposal's photos
-- reach only the owner and its author.

DROP POLICY "Project owners can add log photos" ON public.project_log_media;
DROP POLICY "Project owners can move log photos" ON public.project_log_media;
DROP POLICY "Project owners can remove log photos" ON public.project_log_media;

CREATE POLICY "Owners and authors add log photos" ON public.project_log_media
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.project_log_entries e
        JOIN public.projects p ON p.id = e.project_id
        WHERE e.id = project_log_media.entry_id
          AND ((SELECT public.owns_profile(p.owner_profile_id)) OR (SELECT public.owns_profile(e.author_profile_id)))
    ));

CREATE POLICY "Owners and authors move log photos" ON public.project_log_media
    FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.project_log_entries e
        JOIN public.projects p ON p.id = e.project_id
        WHERE e.id = project_log_media.entry_id
          AND ((SELECT public.owns_profile(p.owner_profile_id)) OR (SELECT public.owns_profile(e.author_profile_id)))
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.project_log_entries e
        JOIN public.projects p ON p.id = e.project_id
        WHERE e.id = project_log_media.entry_id
          AND ((SELECT public.owns_profile(p.owner_profile_id)) OR (SELECT public.owns_profile(e.author_profile_id)))
    ));

CREATE POLICY "Owners and authors remove log photos" ON public.project_log_media
    FOR DELETE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.project_log_entries e
        JOIN public.projects p ON p.id = e.project_id
        WHERE e.id = project_log_media.entry_id
          AND ((SELECT public.owns_profile(p.owner_profile_id)) OR (SELECT public.owns_profile(e.author_profile_id)))
    ));

-- ─── Telling the owner ────────────────────────────────────────────────
--
-- An entry written by anyone but the owner tells the owner: added to the log
-- when it was published, wanting to be when it was proposed. Never from
-- another profile on the owner's own account, which would be telling
-- themselves. Both carry the
-- project, which a tap opens, and the entry, so declining a proposal (which
-- deletes it) takes its notification with it. Both push.

ALTER TABLE public.notifications
    ADD COLUMN project_id UUID,
    ADD COLUMN log_entry_id UUID,
    ADD CONSTRAINT notifications_project_id_fkey
        FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
    ADD CONSTRAINT notifications_log_entry_id_fkey
        FOREIGN KEY (log_entry_id) REFERENCES public.project_log_entries(id) ON DELETE CASCADE;

CREATE INDEX idx_notifications_project ON public.notifications (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_notifications_log_entry ON public.notifications (log_entry_id) WHERE log_entry_id IS NOT NULL;

ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
        'like', 'comment', 'reply', 'follow', 'follow_request', 'comment_like', 'repost', 'mention', 'story_like',
        'log_entry_added', 'log_entry_proposed'
    ));

CREATE OR REPLACE FUNCTION public.notify_on_log_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  project_owner UUID;
BEGIN
  SELECT owner_profile_id INTO project_owner FROM public.projects WHERE id = NEW.project_id;
  IF project_owner IS NULL OR NEW.author_profile_id IS NULL OR NEW.author_profile_id = project_owner THEN
    RETURN NULL;
  END IF;
  IF (SELECT user_id FROM public.profiles WHERE id = NEW.author_profile_id)
     = (SELECT user_id FROM public.profiles WHERE id = project_owner) THEN
    RETURN NULL;
  END IF;
  IF public.blocked_between(NEW.author_profile_id, project_owner) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.notifications (sender_id, receiver_id, type, project_id, log_entry_id, content)
  VALUES (
    NEW.author_profile_id,
    project_owner,
    CASE NEW.status WHEN 'proposed' THEN 'log_entry_proposed' ELSE 'log_entry_added' END,
    NEW.project_id,
    NEW.id,
    left(NEW.title, 50)
  );
  RETURN NULL;
END;
$$;

-- A trigger function, never called directly.
REVOKE ALL ON FUNCTION public.notify_on_log_entry() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER project_log_entries_notify
    AFTER INSERT ON public.project_log_entries
    FOR EACH ROW EXECUTE FUNCTION public.notify_on_log_entry();

-- Both push, as a comment does (send-push knows the types).
DROP TRIGGER notifications_push ON public.notifications;
CREATE TRIGGER notifications_push
    AFTER INSERT ON public.notifications
    FOR EACH ROW
    WHEN (NEW.type IN ('follow', 'follow_request', 'comment', 'reply', 'mention', 'log_entry_added', 'log_entry_proposed'))
    EXECUTE FUNCTION public.push_on_insert();
