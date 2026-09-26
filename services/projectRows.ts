// A Project as a list shows it — its name, type, year and cover — for any
// feature that lists projects (ONE-41).
//
// features/projects lists a profile's owned and contributed projects and the
// projects that use a product; a profile's saves list the projects it saved.
// An api.ts may not import another feature (features/README.md, rule 1), so
// the select and its mapper sit here, as services/postRows.ts does for posts.

/** A project as a list shows it. */
export interface ProjectSummary {
  id: string;
  ownerProfileId: string;
  name: string;
  projectType: string | null;
  year: string | null;
  coverUrl: string | null;
  /** Public or Private. A private one reaches only its owner and contributors. */
  isPublic: boolean;
  createdAt: string;
}

export interface ProjectSummaryRow {
  id: string;
  owner_profile_id: string;
  name: string;
  project_type: string | null;
  year: string | null;
  cover_url: string | null;
  is_public: boolean;
  created_at: string;
}

/** What a list reads of a project. Embeds as `project:projects(…)` from a table that Links one. */
export const PROJECT_SUMMARY_SELECT = 'id, owner_profile_id, name, project_type, year, cover_url, is_public, created_at';

export const mapProjectSummaryRow = (row: ProjectSummaryRow): ProjectSummary => ({
  id: row.id,
  ownerProfileId: row.owner_profile_id,
  name: row.name,
  projectType: row.project_type,
  year: row.year,
  coverUrl: row.cover_url,
  isPublic: row.is_public,
  createdAt: row.created_at,
});

/** Newest first, the order every project list shows. */
export const newestProjectFirst = (a: ProjectSummary, b: ProjectSummary): number => b.createdAt.localeCompare(a.createdAt);
