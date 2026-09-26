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

/** How a destination reads in a row: the profile's name and handle. */
export const destinationLabel = (destination: OwnedTagDestination | null): string =>
  destination ? `${destination.name} · @${destination.username}` : 'Destination removed';

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

/** What the create flow can start with: a replacement's type and destination. */
export interface TagCreatePrefill {
  type?: string;
  destination?: string;
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
  tagCreateRoute({ type: tag.tagType, destination: tag.destination?.profileId });

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

/**
 * The destination a draft points at. One member per kind, like the tag's own
 * destination columns: M5 adds `product` and `project` here and as sections
 * in `destinationSections`.
 */
export type DraftDestination = { kind: 'profile'; id: string };

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
  avatarUri: string | null;
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

/**
 * The destination picker's sections: today, the profiles the account owns and
 * nothing else — no posts (ONE-83), and nobody else's profile, since RLS would
 * refuse the insert and a legitimate-looking choice must not end in an error.
 * M5 appends Products and Projects as further sections.
 */
export const destinationSections = (ownedProfiles: OwnedProfileChoice[]): DestinationSection[] =>
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
  const wanted: DraftDestination | null = prefill.destination ? { kind: 'profile', id: prefill.destination } : null;
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
    destinationProfileId: draft.destination.id,
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
