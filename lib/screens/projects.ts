// Pure logic for the project screens under app/project/ (ONE-41): routes,
// who may do what, the create and edit form, and what each screen says. Kept
// out of the screens so it is tested without mounting anything.

import type { Project, ProjectEdits, ProjectFields } from '../../features/projects';

// ─── Routes ─────────────────────────────────────────────────────────────

export const projectRoute = (projectId: string): string => `/project/${encodeURIComponent(projectId)}`;

export const projectEditRoute = (projectId: string): string => `/project/${encodeURIComponent(projectId)}/edit`;

/** The picker a project's owner Links products from. */
export const projectLinkProductRoute = (projectId: string): string =>
  `/project/${encodeURIComponent(projectId)}/link-product`;

export const PROJECT_CREATE_ROUTE = '/project/create';

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
  isPublic: boolean;
}

/** New projects are public: a project is a discovery surface unless its owner says otherwise. */
export const EMPTY_PROJECT_DRAFT: ProjectDraft = {
  name: '',
  projectType: '',
  year: '',
  description: '',
  coverUri: null,
  isPublic: true,
};

/** A stored project as the edit form starts. */
export const projectDraftFrom = (project: Project): ProjectDraft => ({
  name: project.name,
  projectType: project.projectType ?? '',
  year: project.year ?? '',
  description: project.description ?? '',
  coverUri: project.coverUrl,
  isPublic: project.isPublic,
});

export const projectNameError = (draft: Pick<ProjectDraft, 'name'>): string | null =>
  draft.name.trim() === '' ? 'Give the project a name.' : null;

export const projectDraftValid = (draft: ProjectDraft): boolean => projectNameError(draft) === null;

const textOrNull = (value: string): string | null => value.trim() || null;

export const projectFieldsFrom = (draft: ProjectDraft): ProjectFields => ({
  name: draft.name.trim(),
  projectType: textOrNull(draft.projectType),
  year: textOrNull(draft.year),
  description: textOrNull(draft.description),
  isPublic: draft.isPublic,
});

/** What creating a project from a draft writes. */
export const newProjectInputFrom = (draft: ProjectDraft, ownerProfileId: string) => ({
  ownerProfileId,
  fields: projectFieldsFrom(draft),
  coverUri: draft.coverUri,
});

export const projectEditsFrom = (draft: ProjectDraft): ProjectEdits => ({
  fields: projectFieldsFrom(draft),
  coverUri: draft.coverUri,
});

/** Whether an edit would save anything different from what is stored. */
export const projectDraftChanged = (draft: ProjectDraft, project: Project): boolean =>
  JSON.stringify(projectEditsFrom(draft)) !== JSON.stringify(projectEditsFrom(projectDraftFrom(project)));

/** What the visibility switch says, either way. */
export const projectVisibilityDescription = (isPublic: boolean): string =>
  isPublic
    ? 'Anyone can see it, including someone without the app who scans a tag.'
    : 'Only you and its contributors can see it. To everyone else it does not exist.';

// ─── What the screens say ───────────────────────────────────────────────

/** The project's kind, type and year, as its page's micro-label reads. */
export const projectKindLabel = (project: Pick<Project, 'projectType' | 'year'>): string =>
  ['Project', project.projectType, project.year].filter(Boolean).join(' · ');

/** A list row's subtitle: its type and year, or just "Project". */
export const projectRowSubtitle = (project: Pick<Project, 'projectType' | 'year'>): string =>
  [project.projectType, project.year].filter(Boolean).join(' · ') || 'Project';

export const PRIVATE_LABEL = 'Private';

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
 * printed. Making it private is the reversible alternative.
 */
export const deleteProjectConfirm = (project: Pick<Project, 'name'>) => ({
  title: `Delete ${project.name}?`,
  body:
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
