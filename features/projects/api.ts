// Pure Supabase access for Projects (ONE-41): projects, the products they
// Link, and the contributors they list.
//
// No React, no hooks, nothing from another feature's internals. A product as
// a list shows it comes from services/productRows.ts, and a project as a list
// shows it from services/projectRows.ts. Cover images are uploaded through
// services/destinationMedia.ts, keyed by the account.
//
// What each viewer may read is RLS's to decide, and every read here is
// written so that a row the viewer may not see is simply absent: a private
// project reads as no project at all, never as "private".

import { supabase } from '../../services/supabase.native';
import { uploadDeviceImages } from '../../services/destinationMedia';
import { mapProductSummaryRow, PRODUCT_SUMMARY_SELECT, type ProductSummaryRow } from '../../services/productRows';
import {
  mapProjectSummaryRow,
  newestProjectFirst,
  PROJECT_SUMMARY_SELECT,
  type ProjectSummary,
  type ProjectSummaryRow,
} from '../../services/projectRows';
import type { AuthUserId } from '../../types';
import type {
  Contributor,
  ContributorRow,
  Project,
  ProjectFields,
  ProjectProduct,
  ProjectProfile,
  ProjectProfileRow,
  ProjectRow,
} from './types';

const PROFILE_COLUMNS = 'id, username, full_name, avatar_url, is_verified, profile_type';

/** Everything a project page shows of the project, with its owner embedded. */
export const PROJECT_SELECT = `${PROJECT_SUMMARY_SELECT}, description, owner:profiles!owner_profile_id(${PROFILE_COLUMNS})`;

/** A contributor link with the profile it names. */
export const CONTRIBUTOR_SELECT =
  `id, project_id, contributor_profile_id, role, is_public, added_at, profile:profiles!contributor_profile_id(${PROFILE_COLUMNS})`;

const one = <T>(embed: T | T[] | null | undefined): T | null =>
  Array.isArray(embed) ? embed[0] ?? null : embed ?? null;

const mapProfileRow = (row: ProjectProfileRow): ProjectProfile => ({
  id: row.id,
  username: row.username,
  name: row.full_name || row.username,
  avatarUrl: row.avatar_url,
  isVerified: row.is_verified === true,
  profileType: row.profile_type,
});

export const mapProjectRow = (row: ProjectRow): Project => {
  const owner = one(row.owner);
  return {
    ...mapProjectSummaryRow(row),
    description: row.description,
    owner: owner ? mapProfileRow(owner) : null,
  };
};

export const mapContributorRow = (row: ContributorRow): Contributor => {
  const profile = one(row.profile);
  return {
    id: row.id,
    projectId: row.project_id,
    profileId: row.contributor_profile_id,
    role: row.role,
    isPublic: row.is_public,
    addedAt: row.added_at,
    profile: profile ? mapProfileRow(profile) : null,
  };
};

/** The projects embedded in rows of a table that Links them, newest first, the unreadable left out. */
const embeddedProjects = (rows: { project?: ProjectSummaryRow | ProjectSummaryRow[] | null }[]): ProjectSummary[] =>
  rows
    .map((row) => one(row.project))
    .filter((project): project is ProjectSummaryRow => project !== null)
    .map(mapProjectSummaryRow)
    .sort(newestProjectFirst);

// ─── Reads ───────────────────────────────────────────────────────────────

/**
 * One project, or null when there is none the viewer may see. A private
 * project the viewer is not part of reads exactly like a deleted one, so its
 * page cannot confirm it exists.
 */
export const fetchProject = async (projectId: string): Promise<Project | null> => {
  const { data, error } = await supabase.from('projects').select(PROJECT_SELECT).eq('id', projectId).maybeSingle();
  if (error) throw error;
  return data ? mapProjectRow(data as unknown as ProjectRow) : null;
};

/** The projects a profile owns that the viewer may see, newest first. */
export const fetchOwnedProjects = async (ownerProfileId: string): Promise<ProjectSummary[]> => {
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_SUMMARY_SELECT)
    .eq('owner_profile_id', ownerProfileId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as ProjectSummaryRow[]).map(mapProjectSummaryRow);
};

/**
 * The projects a profile contributed to, newest first — the other direction
 * of discovery, from a profile to its projects.
 *
 * Read from the profile's side of `contributors`, so both rules apply: a
 * link shows only where the viewer may see its project, and a hidden link
 * only to that project's owner and the contributor.
 */
export const fetchContributedProjects = async (profileId: string): Promise<ProjectSummary[]> => {
  const { data, error } = await supabase
    .from('contributors')
    .select(`project:projects(${PROJECT_SUMMARY_SELECT})`)
    .eq('contributor_profile_id', profileId);
  if (error) throw error;
  return embeddedProjects((data ?? []) as unknown as { project?: ProjectSummaryRow | null }[]);
};

/**
 * The projects that Link a product, newest first — "Used in projects" on the
 * product's page (ONE-40). A private project stays out of it for everyone
 * but its owner and contributors.
 */
export const fetchProjectsUsingProduct = async (productId: string): Promise<ProjectSummary[]> => {
  const { data, error } = await supabase
    .from('project_products')
    .select(`project:projects(${PROJECT_SUMMARY_SELECT})`)
    .eq('product_id', productId);
  if (error) throw error;
  return embeddedProjects((data ?? []) as unknown as { project?: ProjectSummaryRow | null }[]);
};

/** A project's contributors the viewer may see, in the order they were added. */
export const fetchContributors = async (projectId: string): Promise<Contributor[]> => {
  const { data, error } = await supabase
    .from('contributors')
    .select(CONTRIBUTOR_SELECT)
    .eq('project_id', projectId)
    .order('added_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as ContributorRow[]).map(mapContributorRow);
};

/** The products a project Links, whoever lists them. */
export const fetchProjectProducts = async (projectId: string): Promise<ProjectProduct[]> => {
  const { data, error } = await supabase
    .from('project_products')
    .select(`id, product:products(${PRODUCT_SUMMARY_SELECT})`)
    .eq('project_id', projectId);
  if (error) throw error;

  return ((data ?? []) as unknown as { id: string; product?: ProductSummaryRow | ProductSummaryRow[] | null }[])
    .map((row) => ({ linkId: row.id, product: one(row.product) }))
    .filter((link): link is { linkId: string; product: ProductSummaryRow } => link.product !== null)
    .map((link) => ({ linkId: link.linkId, product: mapProductSummaryRow(link.product) }));
};

// ─── Writes ──────────────────────────────────────────────────────────────

const fieldsToRow = (fields: Partial<ProjectFields>): Record<string, unknown> => {
  const row: Record<string, unknown> = {};
  if (fields.name !== undefined) row.name = fields.name;
  if (fields.projectType !== undefined) row.project_type = fields.projectType;
  if (fields.description !== undefined) row.description = fields.description;
  if (fields.year !== undefined) row.year = fields.year;
  if (fields.isPublic !== undefined) row.is_public = fields.isPublic;
  return row;
};

/** A cover as stored: uploaded under the account if it is still on the device, kept if not. */
const storedCover = async (authUserId: AuthUserId, coverUri: string | null): Promise<string | null> =>
  coverUri ? (await uploadDeviceImages([coverUri], authUserId, 'projects'))[0]! : null;

/** What creating a project takes. */
export interface NewProjectInput {
  /** The active profile, of either type. */
  ownerProfileId: string;
  fields: ProjectFields;
  /** A device URI, or null for no cover. */
  coverUri: string | null;
}

/**
 * Create a project and return its id. The cover goes up first, keyed by the
 * account, so a failed upload writes nothing.
 */
export const createProject = async (authUserId: AuthUserId, input: NewProjectInput): Promise<string> => {
  const coverUrl = await storedCover(authUserId, input.coverUri);
  const { data, error } = await supabase
    .from('projects')
    .insert({ owner_profile_id: input.ownerProfileId, ...fieldsToRow(input.fields), cover_url: coverUrl })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
};

/**
 * Change a project's fields. RLS filters a project the caller does not own
 * out of the update silently, so an empty result is an error here.
 */
export const updateProject = async (
  projectId: string,
  fields: Partial<ProjectFields> & { coverUrl?: string | null },
): Promise<void> => {
  const row = fieldsToRow(fields);
  if (fields.coverUrl !== undefined) row.cover_url = fields.coverUrl;
  if (Object.keys(row).length === 0) return;
  const { data, error } = await supabase.from('projects').update(row).eq('id', projectId).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Project not found.');
};

/** An edit to a project: its fields and its cover, a device URI, a stored URL, or none. */
export interface ProjectEdits {
  fields: ProjectFields;
  coverUri: string | null;
}

/** Save an edit: a new cover uploaded first, keyed by the account, then the row. */
export const saveProjectEdits = async (authUserId: AuthUserId, projectId: string, edits: ProjectEdits): Promise<void> => {
  const coverUrl = await storedCover(authUserId, edits.coverUri);
  await updateProject(projectId, { ...edits.fields, coverUrl });
};

/**
 * Delete a project. Irreversible: its contributor links, product links and
 * saves cascade with it, and so does any Tag pointing at it — a printed one
 * stops resolving for everyone.
 */
export const deleteProject = async (projectId: string): Promise<void> => {
  const { data, error } = await supabase.from('projects').delete().eq('id', projectId).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Project not found.');
};

/** Postgres' unique violation: already Linked, which is what was asked for. */
const ALREADY_LINKED = '23505';

/**
 * Link a product to a project — any business's product, not only the owner's.
 * The link is the project owner's to make, and RLS holds it to that.
 */
export const linkProduct = async (projectId: string, productId: string): Promise<void> => {
  const { error } = await supabase.from('project_products').insert({ project_id: projectId, product_id: productId });
  if (error && (error as { code?: string }).code !== ALREADY_LINKED) throw error;
};

/** Take a product off a project. The product itself is untouched. */
export const unlinkProduct = async (projectId: string, productId: string): Promise<void> => {
  const { error } = await supabase
    .from('project_products')
    .delete()
    .eq('project_id', projectId)
    .eq('product_id', productId);
  if (error) throw error;
};
