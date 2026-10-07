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

/** The project another sits inside: enough to name it and link to it. */
export interface ProjectParent {
  id: string;
  name: string;
}

/** What a detail holds (ONE-140): words, a number, a date or a link. */
export type ProjectDetailKind = 'text' | 'number' | 'date' | 'link';

/** A detail as the owner edits it: no id until it is stored. */
export interface ProjectDetailInput {
  /** "Filter size", "Warranty until". */
  label: string;
  kind: ProjectDetailKind;
  /** As stored: a date YYYY-MM-DD, a number plain digits, a link http(s). */
  value: string;
}

/** A fact a project's owner keeps on it (ONE-140), as visible as the project. */
export interface ProjectDetail extends ProjectDetailInput {
  id: string;
  sortOrder: number;
}

/** A project, with what its page shows beyond a list's summary. */
export interface Project extends ProjectSummary {
  description: string | null;
  /** Null only if the owning profile could not be read. */
  owner: ProjectProfile | null;
  /**
   * The project this one sits inside (ONE-134), when the viewer may see it.
   * Null at the top level, and for a viewer the parent is hidden from.
   */
  parent: ProjectParent | null;
  /** Its details (ONE-140), in the owner's order. */
  details: ProjectDetail[];
}

/** A photo on a log entry (ONE-141). */
export interface ProjectLogPhoto {
  id: string;
  url: string;
  sortOrder: number;
}

/**
 * Whether an entry shows on the log (ONE-143): published, or proposed by a
 * business that scanned the project's tag, until its owner approves it.
 */
export type LogEntryStatus = 'published' | 'proposed';

/**
 * One dated entry in a project's log (ONE-141): what was done, on which day,
 * by whom, and what it cost — "Mar 12: replaced the igniter, Acme HVAC, $180".
 */
export interface ProjectLogEntry {
  id: string;
  projectId: string;
  /** Who wrote it (ONE-143): the owner, a Contributor, or a business proposing it. */
  authorProfileId: string | null;
  /** That profile, when it could be read. */
  author: ProjectProfile | null;
  status: LogEntryStatus;
  /** The day it was done: YYYY-MM-DD. */
  occurredOn: string;
  title: string;
  notes: string | null;
  /** A record, never a payment: minor units of `currency`, or null for none. */
  costCents: number | null;
  currency: string;
  /** Who did it, or null for no one named. */
  performedByProfileId: string | null;
  /** That profile, when it could be read. */
  performedBy: ProjectProfile | null;
  /** Up to four, in order. */
  photos: ProjectLogPhoto[];
  createdAt: string;
  updatedAt: string;
}

/** A log entry's own fields, as create and edit write them. */
export interface ProjectLogEntryFields {
  occurredOn: string;
  title: string;
  notes: string | null;
  costCents: number | null;
  currency: string;
  performedByProfileId: string | null;
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
  /** Unlisted (ONE-137): never with isPublic. */
  unlisted: boolean;
  /** Optional (ONE-49): one of the fixed interests, or null. */
  interestSlug: string | null;
  /** The project this one sits inside (ONE-134), or null at the top level. */
  parentProjectId: string | null;
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
  unlisted?: boolean | null;
  created_at: string;
  description: string | null;
  /** A one-to-one embed arrives as an object; an older server or a mock may hand back an array. */
  owner?: ProjectProfileRow | ProjectProfileRow[] | null;
  parent_project_id?: string | null;
  /** The parent, when the viewer may see it (ONE-134). */
  parent?: ProjectParent | ProjectParent[] | null;
  /** Its details (ONE-140), in any order. */
  details?: ProjectDetailRow[] | null;
}

/** A `project_log_entries` row with who did it and its photos embedded. */
export interface ProjectLogEntryRow {
  id: string;
  project_id: string;
  occurred_on: string;
  title: string;
  notes: string | null;
  cost_cents: number | null;
  currency: string;
  performed_by_profile_id: string | null;
  author_profile_id: string | null;
  status: LogEntryStatus;
  created_at: string;
  updated_at: string;
  performed_by?: ProjectProfileRow | ProjectProfileRow[] | null;
  author?: ProjectProfileRow | ProjectProfileRow[] | null;
  photos?: { id: string; url: string; sort_order: number }[] | null;
}

/** A `project_details` row. */
export interface ProjectDetailRow {
  id: string;
  label: string;
  kind: ProjectDetailKind;
  value: string;
  sort_order: number;
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
