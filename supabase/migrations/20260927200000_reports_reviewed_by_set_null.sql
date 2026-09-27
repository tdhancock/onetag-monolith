-- A report's reviewer is set null when their profile goes (ONE-98).
--
-- reports.reviewed_by was declared with no ON DELETE, so it was NO ACTION.
-- delete-user-account deletes the auth user and relies on the cascade
-- (ONE-88), and this key stopped it: deleting an account whose profile had
-- reviewed a report failed, and nothing was deleted. Only admins review
-- reports, so only an admin's account was affected.
--
-- A report keeps its history when its reviewer goes: its status and
-- reviewed_at stay, and only who reviewed it is lost.

ALTER TABLE public.reports
    DROP CONSTRAINT reports_reviewed_by_fkey,
    ADD CONSTRAINT reports_reviewed_by_fkey
        FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Deleting any profile now looks its reviewed reports up by this key; without
-- an index that is a full scan of reports. Most reports are never reviewed,
-- so the index holds only the ones that were.
CREATE INDEX reports_reviewed_by ON public.reports (reviewed_by) WHERE reviewed_by IS NOT NULL;
