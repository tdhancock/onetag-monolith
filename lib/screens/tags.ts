// Pure logic for the tag screens under app/tags/ (ONE-32, ONE-33, ONE-34):
// the create flow's steps and draft, the dashboard's filters and labels, and
// the copy each screen says. Kept out of the screens so it is tested without
// mounting anything.
//
// Routes to tag screens are built here too. A tag's *URL* — the one printed on
// a sticker — is never built here or in a screen: that is lib/tagLinks.ts.

import type { NewTag, OwnedTag, OwnedTagDestination, TagType } from '../../features/tags';
import type { ProfileId } from '../../types';
import { getTimeAgo } from '../timeAgo';

// ─── Labels ─────────────────────────────────────────────────────────────

export const TAG_TYPE_LABEL: Record<TagType, string> = {
  physical: 'Physical',
  digital: 'Digital',
  embedded: 'Embedded',
};

/** How a destination reads in a row: a profile's name and handle, or a product's or project's name and kind. */
export const destinationLabel = (destination: OwnedTagDestination | null): string => {
  if (!destination) return 'Destination removed';
  switch (destination.kind) {
    case 'profile':
      return `${destination.name} · @${destination.username}`;
    case 'product':
      return `${destination.name} · Product`;
    case 'project':
      return `${destination.name} · Project`;
  }
};

/** A destination's id, whatever its kind. */
export const destinationIdOf = (destination: OwnedTagDestination): string => {
  switch (destination.kind) {
    case 'profile':
      return destination.profileId;
    case 'product':
      return destination.productId;
    case 'project':
      return destination.projectId;
  }
};

/** A tag's name, or its destination when it has none. */
export const tagTitle = (tag: Pick<OwnedTag, 'name' | 'destination'>): string =>
  tag.name?.trim() || (tag.destination ? tag.destination.name : 'Untitled tag');

export const scanCountLabel = (count: number): string => `${count} ${count === 1 ? 'scan' : 'scans'}`;

/** "12 scans · last 2h", or "No scans yet". Never who scanned (ONE-82). */
export const scanSummary = (tag: Pick<OwnedTag, 'scanCount' | 'lastScannedAt'>): string => {
  if (tag.scanCount === 0) return 'No scans yet';
  const last = getTimeAgo(tag.lastScannedAt);
  return last ? `${scanCountLabel(tag.scanCount)} · last ${last}` : scanCountLabel(tag.scanCount);
};

/** The activation state as a label. Inactive is loud on purpose (ONE-34). */
export const tagStateLabel = (active: boolean): string => (active ? 'Active' : 'Inactive');

// ─── Routes to the tag screens ──────────────────────────────────────────

export const TAGS_DASHBOARD_ROUTE = '/tags';

export const tagDetailRoute = (tagId: string): string => `/tags/${encodeURIComponent(tagId)}`;

export const tagExportRoute = (tagId: string): string => `/tags/${encodeURIComponent(tagId)}/export`;

/**
 * What the create flow can start with: a replacement's type and destination,
 * or a product's or project's own page pre-filling itself (ONE-89). The kind
 * says which the destination id is; a missing one reads as a profile.
 */
export interface TagCreatePrefill {
  type?: string;
  destination?: string;
  kind?: string;
}

export const tagCreateRoute = (prefill: TagCreatePrefill = {}) => ({
  pathname: '/tags/create' as const,
  params: Object.fromEntries(Object.entries(prefill).filter(([, value]) => value)) as Record<string, string>,
});

/**
 * "Create a replacement" for a damaged or lost Physical Tag: the create flow,
 * pre-filled with the same destination. The original is left alone, so its
 * owner deactivates it deliberately.
 */
export const replacementRoute = (tag: Pick<OwnedTag, 'tagType' | 'destination'>) =>
  tagCreateRoute({
    type: tag.tagType,
    destination: tag.destination ? destinationIdOf(tag.destination) : undefined,
    kind: tag.destination?.kind,
  });

// ─── The dashboard: filters ─────────────────────────────────────────────

export type TagTypeFilter = 'all' | TagType;
export type TagStateFilter = 'all' | 'active' | 'inactive';

/**
 * Every tag type, Embedded included: none exist until M6, but Embedded Tags
 * may then arrive by the hundred, and the filter is what keeps the list usable.
 */
export const TAG_TYPE_FILTERS: { value: TagTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'physical', label: TAG_TYPE_LABEL.physical },
  { value: 'digital', label: TAG_TYPE_LABEL.digital },
  { value: 'embedded', label: TAG_TYPE_LABEL.embedded },
];

export const TAG_STATE_FILTERS: { value: TagStateFilter; label: string }[] = [
  { value: 'all', label: 'Any state' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

/** The tags a pair of filters leaves, newest first. */
export const filterTags = <T extends Pick<OwnedTag, 'tagType' | 'active' | 'createdAt'>>(
  tags: T[],
  type: TagTypeFilter,
  state: TagStateFilter,
): T[] =>
  tags
    .filter((tag) => type === 'all' || tag.tagType === type)
    .filter((tag) => state === 'all' || (state === 'active') === tag.active)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

// ─── The dashboard: what it says ────────────────────────────────────────

/**
 * An account's first encounter with Tags is usually this screen, so the empty
 * state says what a Tag is before offering to make one.
 */
export const TAGS_EMPTY_STATE = {
  title: 'No tags yet',
  body:
    'A Tag is a portal to one place on OneTag. Print a Physical Tag as a QR code for the real world, ' +
    'or share a Digital Tag as a link. Whoever scans or opens it lands there.',
  action: 'Create a tag',
} as const;

export const TAGS_FILTERED_EMPTY_STATE = {
  title: 'No tags match',
  body: 'Nothing here fits these filters.',
  action: 'Show all tags',
} as const;

/**
 * What deleting a tag means, said before anything is removed (ONE-34). A
 * Physical Tag is an object someone else may now be holding; deleting its row
 * kills every copy of its code for good. Deactivating is the reversible
 * alternative, and the confirmation says so.
 */
export const deleteTagConfirm = (tag: Pick<OwnedTag, 'tagType' | 'shortCode'>) => ({
  title: 'Delete this tag?',
  body:
    (tag.tagType === 'physical'
      ? `Anything printed with ${tag.shortCode} will stop working for everyone, permanently. `
      : `Every copy of this tag's link will stop working for everyone, permanently. `) +
    'Its scan count is deleted too. To stop it for now, make it inactive instead: that can be undone.',
  confirm: 'Delete permanently',
});

export const TAG_NAME_MAX_LENGTH = 60;
export const TAG_NOTE_MAX_LENGTH = 280;

/** A name or note as stored: trimmed, and null when empty. */
export const tagTextOrNull = (value: string): string | null => value.trim() || null;

// ─── The create flow ────────────────────────────────────────────────────

/** Choose type → choose destination → name and note → confirm (ONE-32). */
export const TAG_CREATE_STEPS = ['type', 'destination', 'details', 'confirm'] as const;
export type TagCreateStep = (typeof TAG_CREATE_STEPS)[number];

export type CreatableTagType = NewTag['tagType'];

export const TAG_CREATE_STEP_TITLE: Record<TagCreateStep, string> = {
  type: 'What kind of tag?',
  destination: 'Where does it go?',
  details: 'Name it',
  confirm: 'Check and create',
};

/** Embedded Tags are made in the post composer (M6), never here. */
export const CREATABLE_TAG_TYPES: { type: CreatableTagType; label: string; description: string }[] = [
  {
    type: 'physical',
    label: 'Physical Tag',
    description: 'A QR code for the real world: a sticker, a card, a plate. Anyone can scan it, any time.',
  },
  {
    type: 'digital',
    label: 'Digital Tag',
    description: 'A short link you share from the app, when you choose to.',
  },
];

const isCreatableType = (value: unknown): value is CreatableTagType =>
  value === 'physical' || value === 'digital';

/** The destination a draft points at: one of the three kinds the tag's columns hold. */
export type DraftDestination = { kind: 'profile' | 'product' | 'project'; id: string };

const DESTINATION_KINDS: DraftDestination['kind'][] = ['profile', 'product', 'project'];

const isDestinationKind = (value: unknown): value is DraftDestination['kind'] =>
  DESTINATION_KINDS.includes(value as DraftDestination['kind']);

export interface TagDraft {
  tagType: CreatableTagType | null;
  destination: DraftDestination | null;
  name: string;
  note: string;
}

export const EMPTY_TAG_DRAFT: TagDraft = { tagType: null, destination: null, name: '', note: '' };

/** A choice the destination picker offers. */
export interface DestinationOption {
  destination: DraftDestination;
  title: string;
  subtitle: string;
  /** A profile's avatar, drawn round. */
  avatarUri?: string | null;
  /** A product's or project's picture, drawn square; null for one without. */
  imageUri?: string | null;
}

export interface DestinationSection {
  kind: DraftDestination['kind'];
  title: string;
  options: DestinationOption[];
}

/** A profile, as much of one as the picker shows. */
export interface OwnedProfileChoice {
  id: string;
  name: string;
  username: string;
  profileType?: 'individual' | 'business';
  profilePicture?: string | null;
}

/** A product, as much of one as the picker shows. */
export interface OwnedProductChoice {
  id: string;
  name: string;
  category?: string | null;
  imageUrl?: string | null;
}

/** A project, as much of one as the picker shows. */
export interface OwnedProjectChoice {
  id: string;
  name: string;
  projectType?: string | null;
  coverUrl?: string | null;
  isPublic?: boolean;
}

/**
 * The destination picker's sections: the profiles, products and projects the
 * account owns, and nothing else (ONE-89) — no posts (ONE-83), and nothing of
 * anyone else's, since RLS would refuse the insert and a legitimate-looking
 * choice must not end in an error. A kind with nothing to offer is left out.
 */
export const destinationSections = (
  ownedProfiles: OwnedProfileChoice[],
  ownedProducts: OwnedProductChoice[] = [],
  ownedProjects: OwnedProjectChoice[] = [],
): DestinationSection[] =>
  [
    {
      kind: 'profile' as const,
      title: 'Your profiles',
      options: ownedProfiles.map((profile) => ({
        destination: { kind: 'profile' as const, id: profile.id },
        title: profile.name || profile.username,
        subtitle: `@${profile.username} · ${profile.profileType === 'business' ? 'Business' : 'Individual'}`,
        avatarUri: profile.profilePicture ?? null,
      })),
    },
    {
      kind: 'product' as const,
      title: 'Your products',
      options: ownedProducts.map((product) => ({
        destination: { kind: 'product' as const, id: product.id },
        title: product.name,
        subtitle: ['Product', product.category].filter(Boolean).join(' · '),
        imageUri: product.imageUrl ?? null,
      })),
    },
    {
      kind: 'project' as const,
      title: 'Your projects',
      options: ownedProjects.map((project) => ({
        destination: { kind: 'project' as const, id: project.id },
        title: project.name,
        subtitle: ['Project', project.projectType, project.isPublic === false ? 'Private' : null]
          .filter(Boolean)
          .join(' · '),
        imageUri: project.coverUrl ?? null,
      })),
    },
  ].filter((section) => section.options.length > 0);

const offers = (sections: DestinationSection[], destination: DraftDestination | null): boolean =>
  destination !== null &&
  sections.some(
    (section) =>
      section.kind === destination.kind && section.options.some((option) => option.destination.id === destination.id),
  );

/** The option a draft's destination is, if the picker offers it. */
export const chosenDestination = (
  sections: DestinationSection[],
  destination: DraftDestination | null,
): DestinationOption | null => {
  if (!destination) return null;
  for (const section of sections) {
    if (section.kind !== destination.kind) continue;
    const found = section.options.find((option) => option.destination.id === destination.id);
    if (found) return found;
  }
  return null;
};

/** Whether a step's answer is in, so the flow may move past it. */
export const canContinue = (step: TagCreateStep, draft: TagDraft, sections: DestinationSection[]): boolean => {
  switch (step) {
    case 'type':
      return draft.tagType !== null;
    case 'destination':
      return offers(sections, draft.destination);
    case 'details':
      return draft.name.length <= TAG_NAME_MAX_LENGTH && draft.note.length <= TAG_NOTE_MAX_LENGTH;
    case 'confirm':
      return (
        draft.tagType !== null &&
        offers(sections, draft.destination) &&
        canContinue('details', draft, sections)
      );
  }
};

export const stepIndex = (step: TagCreateStep): number => TAG_CREATE_STEPS.indexOf(step);

export const nextStep = (step: TagCreateStep): TagCreateStep | null =>
  TAG_CREATE_STEPS[stepIndex(step) + 1] ?? null;

export const previousStep = (step: TagCreateStep): TagCreateStep | null =>
  TAG_CREATE_STEPS[stepIndex(step) - 1] ?? null;

export const stepProgressLabel = (step: TagCreateStep): string =>
  `Step ${stepIndex(step) + 1} of ${TAG_CREATE_STEPS.length}`;

/**
 * Where the flow starts, and with what.
 *
 * A replacement arrives with a type and a destination, and starts at naming
 * it — one step from a new sticker. A pre-filled destination the account
 * does not own is ignored rather than offered: route params are input.
 */
export const initialTagCreate = (
  prefill: TagCreatePrefill,
  sections: DestinationSection[],
): { draft: TagDraft; step: TagCreateStep } => {
  const tagType = isCreatableType(prefill.type) ? prefill.type : null;
  const kind = isDestinationKind(prefill.kind) ? prefill.kind : 'profile';
  const wanted: DraftDestination | null = prefill.destination ? { kind, id: prefill.destination } : null;
  const destination = offers(sections, wanted) ? wanted : null;
  const draft: TagDraft = { ...EMPTY_TAG_DRAFT, tagType, destination };

  if (tagType && destination) return { draft, step: 'details' };
  if (tagType) return { draft, step: 'destination' };
  return { draft, step: 'type' };
};

/** The insert a finished draft makes, or null while it is incomplete. */
export const newTagFromDraft = (draft: TagDraft, ownerProfileId: ProfileId): NewTag | null => {
  if (!draft.tagType || !draft.destination) return null;
  return {
    ownerProfileId,
    tagType: draft.tagType,
    destination: { kind: draft.destination.kind, id: draft.destination.id },
    name: tagTextOrNull(draft.name),
    note: tagTextOrNull(draft.note),
  };
};

/** Why a create failed, in words that say the draft is still there. */
export const CREATE_TAG_FAILED = "Couldn't create the tag. Nothing you entered was lost; try again.";

// ─── The QR export ──────────────────────────────────────────────────────

/** Said when Photos access is refused, with the way round it (ONE-33). */
export const PHOTOS_DENIED_MESSAGE =
  "OneTag doesn't have access to your photos, so the QR code wasn't saved. " +
  'Allow photo access in Settings, or use Share to send it anywhere else.';
