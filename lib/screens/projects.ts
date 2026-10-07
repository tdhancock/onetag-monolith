// Pure logic for the project screens under app/project/ (ONE-41): routes,
// who may do what, the create and edit form, and what each screen says. Kept
// out of the screens so it is tested without mounting anything.

import type { Contributor, Project, ProjectEdits, ProjectFields, ProjectSummary } from '../../features/projects';
import type { NewTag, OwnedTag } from '../../features/tags';
import type { ProfileId } from '../../types';
import {
  detailDraftErrors,
  detailDraftsFrom,
  detailEditsFrom,
  detailInputsFrom,
  type ProjectDetailDraft,
} from './projectDetails';

// ─── Routes ─────────────────────────────────────────────────────────────

export const projectRoute = (projectId: string): string => `/project/${encodeURIComponent(projectId)}`;

export const projectEditRoute = (projectId: string): string => `/project/${encodeURIComponent(projectId)}/edit`;

/** The picker a project's owner Links products from. */
export const projectLinkProductRoute = (projectId: string): string =>
  `/project/${encodeURIComponent(projectId)}/link-product`;

/** The picker a project's owner adds Contributors from (ONE-42). */
export const projectAddContributorRoute = (projectId: string): string =>
  `/project/${encodeURIComponent(projectId)}/add-contributor`;

export const PROJECT_CREATE_ROUTE = '/project/create';

/**
 * Project create, starting inside another project (ONE-134) when one is
 * given: "Add a project" on a house's page.
 */
export const projectCreateRoute = (parentProjectId?: string) => ({
  pathname: PROJECT_CREATE_ROUTE,
  params: parentProjectId ? { parent: parentProjectId } : ({} as Record<string, string>),
});

// ─── Who may do what ────────────────────────────────────────────────────

/**
 * Whether the active profile manages this project: it must be the profile
 * that owns it. Either type may own one, so this is the only test.
 */
export const canManageProject = (
  profileId: string | undefined,
  project: Pick<Project, 'ownerProfileId'> | null | undefined,
): boolean => Boolean(profileId && project && project.ownerProfileId === profileId);

// ─── The create and edit form ───────────────────────────────────────────

export const PROJECT_NAME_MAX_LENGTH = 80;
export const PROJECT_TYPE_MAX_LENGTH = 40;
export const PROJECT_YEAR_MAX_LENGTH = 20;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 2000;

export interface ProjectDraft {
  name: string;
  projectType: string;
  /** Free text, as stored: "2025", or "2024–2025". */
  year: string;
  description: string;
  /** A stored URL, a photo just picked from the device, or none. */
  coverUri: string | null;
  /** Public, Unlisted (ONE-137) or Private. */
  visibility: ProjectVisibility;
  /** Optional: an interest slug, or null (ONE-49). */
  interestSlug: string | null;
  /** The project this one sits inside (ONE-134), or null at the top level. */
  parentProjectId: string | null;
  /** Its details (ONE-140), in order. Any left without a value are not saved. */
  details: ProjectDetailDraft[];
}

/** New projects are public: a project is a discovery surface unless its owner says otherwise. */
export const EMPTY_PROJECT_DRAFT: ProjectDraft = {
  name: '',
  projectType: '',
  year: '',
  description: '',
  coverUri: null,
  visibility: 'public',
  interestSlug: null,
  parentProjectId: null,
  details: [],
};

/** A stored project as the edit form starts. */
export const projectDraftFrom = (project: Project): ProjectDraft => ({
  name: project.name,
  projectType: project.projectType ?? '',
  year: project.year ?? '',
  description: project.description ?? '',
  coverUri: project.coverUrl,
  visibility: visibilityOf(project),
  interestSlug: project.interestSlug ?? null,
  parentProjectId: project.parentProjectId ?? null,
  details: detailDraftsFrom(project.details),
});

export const projectNameError = (draft: Pick<ProjectDraft, 'name'>): string | null =>
  draft.name.trim() === '' ? 'Give the project a name.' : null;

/**
 * What is wrong with a draft, field by field: a name is required, and each
 * detail's value must suit its kind (ONE-140), keyed `details[0].value`.
 */
export const projectDraftErrors = (draft: ProjectDraft): { name: string | null } & Record<string, string | null> => ({
  ...detailDraftErrors(draft.details),
  name: projectNameError(draft),
});

export const projectDraftValid = (draft: ProjectDraft): boolean =>
  Object.values(projectDraftErrors(draft)).every((error) => error === null);

const textOrNull = (value: string): string | null => value.trim() || null;

export const projectFieldsFrom = (draft: ProjectDraft): ProjectFields => ({
  name: draft.name.trim(),
  projectType: textOrNull(draft.projectType),
  year: textOrNull(draft.year),
  description: textOrNull(draft.description),
  isPublic: draft.visibility === 'public',
  unlisted: draft.visibility === 'unlisted',
  interestSlug: draft.interestSlug,
  parentProjectId: draft.parentProjectId,
});

/** What creating a project from a draft writes. */
export const newProjectInputFrom = (draft: ProjectDraft, ownerProfileId: string) => ({
  ownerProfileId,
  fields: projectFieldsFrom(draft),
  coverUri: draft.coverUri,
  details: detailInputsFrom(draft.details),
});

export const projectEditsFrom = (draft: ProjectDraft): ProjectEdits => ({
  fields: projectFieldsFrom(draft),
  coverUri: draft.coverUri,
  details: detailEditsFrom(draft.details),
});

/** Whether an edit would save anything different from what is stored. */
export const projectDraftChanged = (draft: ProjectDraft, project: Project): boolean =>
  JSON.stringify(projectEditsFrom(draft)) !== JSON.stringify(projectEditsFrom(projectDraftFrom(project)));

/** Who can see a project (ONE-137). Stored as is_public and unlisted, never both. */
export type ProjectVisibility = 'public' | 'unlisted' | 'private';

/** A stored project's visibility, from its two columns. */
export const visibilityOf = (project: { isPublic: boolean; unlisted?: boolean }): ProjectVisibility =>
  project.isPublic ? 'public' : project.unlisted ? 'unlisted' : 'private';

/** The three choices the project form offers, in order. */
export const PROJECT_VISIBILITIES: { value: ProjectVisibility; label: string }[] = [
  { value: 'public', label: 'Public' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'private', label: 'Private' },
];

/** What each visibility means, said under its choice. */
export const projectVisibilityDescription = (visibility: ProjectVisibility): string => {
  switch (visibility) {
    case 'public':
      return 'Anyone can see it, in Explore and search, including someone without the app who scans a tag.';
    case 'unlisted':
      return "Anyone with its tag can see it, but it isn't listed anywhere: not in Explore, search or on your profile.";
    case 'private':
      return 'Only you and its contributors can see it. To everyone else it does not exist.';
  }
};

// ─── What the screens say ───────────────────────────────────────────────

/** The project's kind, type and year, as its page's micro-label reads. */
export const projectKindLabel = (project: Pick<Project, 'projectType' | 'year'>): string =>
  ['Project', project.projectType, project.year].filter(Boolean).join(' · ');

/** A list row's subtitle: its type and year, or just "Project". */
export const projectRowSubtitle = (project: Pick<Project, 'projectType' | 'year'>): string =>
  [project.projectType, project.year].filter(Boolean).join(' · ') || 'Project';

export const PRIVATE_LABEL = 'Private';
export const UNLISTED_LABEL = 'Unlisted';

/** The badge a project's rows and page carry: nothing for a public one. */
export const visibilityBadge = (project: { isPublic: boolean; unlisted?: boolean }): string | null => {
  const visibility = visibilityOf(project);
  return visibility === 'public' ? null : visibility === 'unlisted' ? UNLISTED_LABEL : PRIVATE_LABEL;
};

/**
 * How a project's Share works. A public or private one shares the app's link
 * to its page. An unlisted one's page opens only for someone holding its tag,
 * so its owner shares a Digital Tag's link instead, which grants whoever
 * opens it; anyone else gets no Share at all.
 */
export const projectShareFor = (
  project: { isPublic: boolean; unlisted?: boolean },
  isOwner: boolean,
): 'app-link' | 'tag-link' | null => (!project.unlisted ? 'app-link' : isOwner ? 'tag-link' : null);

/** What the owner's Tags list calls a Digital Tag made by sharing an unlisted project. */
export const SHARED_LINK_TAG_NAME = 'Shared link';

/** The owner's Digital Tag an unlisted project is shared through: an active one pointing at it. */
export const shareableTagFor = (tags: OwnedTag[] | undefined, projectId: string): OwnedTag | null =>
  tags?.find(
    (tag) =>
      tag.tagType === 'digital' &&
      tag.active &&
      tag.destination?.kind === 'project' &&
      tag.destination.projectId === projectId,
  ) ?? null;

/** The Digital Tag made when there isn't one to share an unlisted project through. */
export const shareTagFor = (ownerProfileId: ProfileId, projectId: string): NewTag => ({
  ownerProfileId,
  tagType: 'digital',
  destination: { kind: 'project', id: projectId },
  name: SHARED_LINK_TAG_NAME,
  note: null,
});

/**
 * Projects as a list shows them to a viewer (ONE-137): an unlisted one is
 * listed nowhere but to its owner, even to someone who holds its tag.
 */
export const listedFor = <T extends Pick<ProjectSummary, 'unlisted' | 'ownerProfileId'>>(
  projects: T[],
  viewerProfileId: string | undefined,
): T[] => projects.filter((project) => !project.unlisted || project.ownerProfileId === viewerProfileId);

const counted = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/**
 * The stats strip: contributors and products, and for the owner alone, how
 * often their tags pointing at it were scanned (ONE-82: how often, never who).
 */
export const projectStats = (counts: { contributors: number; products: number; scans?: number }): string[] => [
  counted(counts.contributors, 'contributor', 'contributors'),
  counted(counts.products, 'product', 'products'),
  ...(counts.scans === undefined ? [] : [counted(counts.scans, 'scan', 'scans')]),
];

/** An empty contributors section: a prompt for the owner, an explanation for everyone else. */
export const contributorsEmptyState = (isOwner: boolean) =>
  isOwner
    ? {
        title: 'No contributors yet',
        body: 'Add the people and businesses who worked on this project. Each one links to their profile.',
      }
    : {
        title: 'No contributors listed',
        body: 'Contributors are the people and businesses who worked on a project.',
      };

/** An empty products section: a prompt for the owner, an explanation for everyone else. */
export const productsEmptyState = (isOwner: boolean) =>
  isOwner
    ? {
        title: 'No products Linked yet',
        body: 'Link the products this project used: your own, or any business\'s.',
      }
    : {
        title: 'No products Linked',
        body: 'Products used in a project show here, each leading to its page.',
      };

/**
 * A project that does not exist and a private one the viewer is not part of
 * read the same, so the page never confirms a private project exists.
 */
export const PROJECT_NOT_FOUND = {
  title: 'Project not found',
  body: "It may have been removed, or the link isn't right.",
} as const;

/**
 * What deleting a project means, said before anything is removed (ONE-41):
 * its contributors lose the link, and a Tag pointing at it may already be
 * printed. Making it private is the reversible alternative. The projects
 * inside it go with it (ONE-134), and it says how many.
 */
export const deleteProjectConfirm = (project: Pick<Project, 'name'>, inside = 0) => ({
  title: `Delete ${project.name}?`,
  body:
    (inside > 0 ? `This also deletes the ${counted(inside, 'project', 'projects')} inside it. ` : '') +
    'Its contributors lose the link to it, and its product links and saves are deleted with it. ' +
    'Any tag pointing at it stops working for good, including one already printed. ' +
    'To hide it for now, make it private instead: that can be undone.',
  confirm: 'Delete permanently',
});

export const unlinkProductConfirm = (productName: string) => ({
  title: `Remove ${productName}?`,
  body: 'It will no longer show on this project. The product itself is not changed.',
  confirm: 'Remove',
});

export const PROJECT_SAVE_FAILED = "Couldn't save the project. Nothing you entered was lost; try again.";
export const PROJECT_PHOTO_FAILED = "The cover couldn't be uploaded, so nothing was saved. Try again.";

// ─── Contributors (ONE-42) ──────────────────────────────────────────────
//
// A Contributor is "added as a Contributor", never "tagged": a Tag is a
// portal to a Destination, and the two must not blur.

export const CONTRIBUTOR_ROLE_MAX_LENGTH = 60;

/** What a hidden link says, to the only two who can see it: the owner and that contributor. */
export const HIDDEN_FROM_VISITORS = 'Hidden from visitors';

/** A role as stored: trimmed, or null for none. */
export const contributorRoleOrNull = (value: string): string | null => value.trim() || null;

/** "Hidden from visitors · Supplied the tile · Business" — what a contributor row says under the name. */
export const contributorSubtitle = (contributor: Pick<Contributor, 'role' | 'isPublic' | 'profile'>): string =>
  [
    contributor.isPublic ? null : HIDDEN_FROM_VISITORS,
    contributor.role,
    contributor.profile?.profileType === 'business' ? 'Business' : 'Individual',
  ]
    .filter(Boolean)
    .join(' · ');

/**
 * The active profile's own link to a project, when it is a contributor there
 * but not its owner — the case that gets "Remove me from this project".
 */
export const ownContributorLink = (
  profileId: string | undefined,
  project: Pick<Project, 'ownerProfileId'>,
  contributors: Contributor[] | undefined,
): Contributor | null =>
  profileId && project.ownerProfileId !== profileId
    ? contributors?.find((contributor) => contributor.profileId === profileId) ?? null
    : null;

/**
 * Who the picker offers: everyone the search found except profiles already
 * Linked — hidden links included — so the unique constraint is never the
 * thing that says no. The owner's own profile stays: an owner may add
 * themselves, a business that both ran and supplied a job.
 */
export const contributorCandidates = <T extends { id: string }>(
  results: T[] | undefined,
  contributors: Pick<Contributor, 'profileId'>[] | undefined,
): T[] => {
  const linked = new Set((contributors ?? []).map((contributor) => contributor.profileId));
  return (results ?? []).filter((result) => !linked.has(result.id));
};

/** Said before a contributor removes themselves: what it does, and that only the owner can undo it. */
export const removeSelfConfirm = (project: Pick<Project, 'name' | 'isPublic'>) => ({
  title: `Remove yourself from ${project.name}?`,
  body:
    "You'll no longer be listed as a contributor, and it leaves your profile's projects. " +
    (project.isPublic ? '' : "It's private, so you'll no longer be able to see it. ") +
    "Only the project's owner can add you back.",
  confirm: 'Remove me',
});

/** Said before the owner removes a contributor. */
export const removeContributorConfirm = (name: string) => ({
  title: `Remove ${name}?`,
  body: 'They will no longer be listed on this project, and it leaves their profile. You can add them again later.',
  confirm: 'Remove',
});

/** The visibility row in a contributor's options, either way. */
export const contributorVisibilityAction = (isPublic: boolean) =>
  isPublic
    ? { label: 'Hide from visitors', hint: 'Only you and they will see them listed.' }
    : { label: 'Show to visitors', hint: 'Everyone who can see the project will see them listed.' };

// ─── Projects inside a project (ONE-134) ────────────────────────────────

/** A project another can go inside: one of the owner's, at the top level. */
export interface ProjectParentChoice {
  id: string;
  name: string;
}

/**
 * What "Part of" offers: the profile's own top-level projects, newest first,
 * never the project itself. One level only, so a project inside another is
 * never offered as a parent.
 */
export const parentChoices = (
  owned: Pick<ProjectSummary, 'id' | 'name' | 'parentProjectId'>[],
  projectId?: string,
): ProjectParentChoice[] =>
  owned.filter((p) => !p.parentProjectId && p.id !== projectId).map(({ id, name }) => ({ id, name }));

/** What "Part of" reads when a project sits inside nothing. */
export const NOT_PART_OF_ANYTHING = 'None';

/** The name "Part of" shows for a parent, or None. */
export const partOfLabel = (choices: ProjectParentChoice[], parentProjectId: string | null): string =>
  (parentProjectId && choices.find((choice) => choice.id === parentProjectId)?.name) || NOT_PART_OF_ANYTHING;

/** Top-level projects only: what a profile's Projects tab lists (ONE-134). */
export const topLevelProjects = <T extends Pick<ProjectSummary, 'parentProjectId'>>(projects: T[]): T[] =>
  projects.filter((project) => !project.parentProjectId);

/** The section on a project's page listing the projects inside it. */
export const INCLUDES_TITLE = 'Includes';

/** An empty Includes section, which only its owner sees. */
export const INCLUDES_EMPTY = {
  title: 'Nothing inside it yet',
  body: 'Add the things this project holds, like the furnace in a house. Each gets its own page and its own tag.',
} as const;

/** "Part of House" — how a project inside another names it. */
export const partOfText = (parentName: string): string => `Part of ${parentName}`;
