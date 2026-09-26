// Domain types for Projects (ONE-41).
//
// A Project is a build, install or completed work — the core discovery page.
// It Links Contributors (the profiles who took part) and the Products it
// used, and discovery runs both ways. Either profile type may own one, and it
// is Public or Private: a private project reaches only its owner and its
// contributors, and to everyone else does not exist.
//
// A project as a list shows it lives in services/projectRows.ts, since other
// features list projects too; it is re-exported here with the rest.

import type { ProjectSummary } from '../../services/projectRows';
import type { ProductSummary } from '../../services/productRows';

export type { ProjectSummary, ProjectSummaryRow } from '../../services/projectRows';

/** A profile as a project page shows it: its owner, or a contributor. */
export interface ProjectProfile {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  isVerified: boolean;
  profileType: 'individual' | 'business';
}

/** A project, with what its page shows beyond a list's summary. */
export interface Project extends ProjectSummary {
  description: string | null;
  /** Null only if the owning profile could not be read. */
  owner: ProjectProfile | null;
}

/** A Product a project Links: "Products used". */
export interface ProjectProduct {
  /** The `project_products` row. */
  linkId: string;
  product: ProductSummary;
}

/**
 * A profile Linked to a project as a Contributor — a participant, supplier or
 * collaborator, business or individual.
 */
export interface Contributor {
  /** The `contributors` row. */
  id: string;
  projectId: string;
  profileId: string;
  /** Free text: "Architect", "Supplied the tile". */
  role: string | null;
  /** A hidden link is visible only to the project's owner and this contributor. */
  isPublic: boolean;
  addedAt: string;
  /** Null only if the profile could not be read. */
  profile: ProjectProfile | null;
}

/** A project's own fields, as create and edit write them. */
export interface ProjectFields {
  name: string;
  projectType: string | null;
  description: string | null;
  year: string | null;
  isPublic: boolean;
}

// ─── Rows ────────────────────────────────────────────────────────────────

export interface ProjectProfileRow {
  id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  is_verified: boolean | null;
  profile_type: 'individual' | 'business';
}

/** A `projects` row with its owner embedded. */
export interface ProjectRow {
  id: string;
  owner_profile_id: string;
  name: string;
  project_type: string | null;
  year: string | null;
  cover_url: string | null;
  is_public: boolean;
  created_at: string;
  description: string | null;
  /** A one-to-one embed arrives as an object; an older server or a mock may hand back an array. */
  owner?: ProjectProfileRow | ProjectProfileRow[] | null;
}

/** A `contributors` row with its profile embedded. */
export interface ContributorRow {
  id: string;
  project_id: string;
  contributor_profile_id: string;
  role: string | null;
  is_public: boolean;
  added_at: string;
  profile?: ProjectProfileRow | ProjectProfileRow[] | null;
}
