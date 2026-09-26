// Pure logic for placing Embedded Tags in the composer (ONE-46).
//
// A post does not exist until it is published, but a tag needs its host post
// (ONE-44). So tags are drafts in the composer's own state, positioned in
// percent of the picture's content from the moment they are placed, and are
// written only once the post insert has returned its id.

import { clampPct } from './embeddedTags';
import type { EmbeddedTag, EmbeddedTagDestination } from '../../types';

/** The most tags one photo may carry. Twenty on one photo is unusable, and a sign of misuse. */
export const MAX_EMBEDDED_TAGS = 10;

/** Why an eleventh tag can't be placed. */
export const TAG_LIMIT_MESSAGE = `A photo can carry up to ${MAX_EMBEDDED_TAGS} tags. Remove one to add another.`;

/** A tag being placed. `destination` is null only while its picker is open. */
export interface DraftTag {
  key: string;
  xPct: number;
  yPct: number;
  destination: EmbeddedTagDestination | null;
}

let nextKey = 0;
const draftKey = (): string => {
  nextKey += 1;
  return `draft-${nextKey}`;
};

export type PlaceResult = { ok: true; drafts: DraftTag[]; key: string } | { ok: false; message: string };

/** Place a tag, with no destination yet, at a position — unless the photo is full. */
export const placeTag = (drafts: DraftTag[], xPct: number, yPct: number): PlaceResult => {
  if (drafts.length >= MAX_EMBEDDED_TAGS) return { ok: false, message: TAG_LIMIT_MESSAGE };
  const key = draftKey();
  return { ok: true, key, drafts: [...drafts, { key, xPct: clampPct(xPct), yPct: clampPct(yPct), destination: null }] };
};

/** Move a placed tag. Clamped, so the database's range check never has to catch it. */
export const moveTag = (drafts: DraftTag[], key: string, xPct: number, yPct: number): DraftTag[] =>
  drafts.map((d) => (d.key === key ? { ...d, xPct: clampPct(xPct), yPct: clampPct(yPct) } : d));

export const removeTag = (drafts: DraftTag[], key: string): DraftTag[] => drafts.filter((d) => d.key !== key);

export const setTagDestination = (drafts: DraftTag[], key: string, destination: EmbeddedTagDestination): DraftTag[] =>
  drafts.map((d) => (d.key === key ? { ...d, destination } : d));

/** Drop any tag whose picker was closed without a choice. */
export const withDestinations = (drafts: DraftTag[]): (DraftTag & { destination: EmbeddedTagDestination })[] =>
  drafts.filter((d): d is DraftTag & { destination: EmbeddedTagDestination } => d.destination !== null);

/** The drafts as viewers will see them, for the preview through `EmbeddedTags`. */
export const previewTags = (drafts: DraftTag[]): EmbeddedTag[] =>
  withDestinations(drafts).map((d) => ({ id: d.key, xPct: d.xPct, yPct: d.yPct, destination: d.destination }));

/** A destination as the tags table stores it: its kind and its id. */
export const destinationRef = (destination: EmbeddedTagDestination): { kind: EmbeddedTagDestination['kind']; id: string } => {
  switch (destination.kind) {
    case 'profile':
      return { kind: 'profile', id: destination.profileId };
    case 'product':
      return { kind: 'product', id: destination.productId };
    case 'project':
      return { kind: 'project', id: destination.projectId };
  }
};

/** What `createEmbeddedTags` writes once the post has an id. */
export const tagsToWrite = (drafts: DraftTag[]) =>
  withDestinations(drafts).map((d) => ({ destination: destinationRef(d.destination), xPct: d.xPct, yPct: d.yPct }));

/** The running count beside the photo. */
export const tagCountLabel = (count: number): string => `${count} / ${MAX_EMBEDDED_TAGS} TAGGED`;

// ─── The destination picker ─────────────────────────────────────────────

/** A picker search is sent once it has this many characters. */
export const TAG_SEARCH_MIN_LENGTH = 2;

export interface PickerProfile {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  profileType: 'individual' | 'business';
}
export interface PickerProduct {
  id: string;
  name: string;
  imageUrl: string | null;
  businessName: string | null;
}
export interface PickerProject {
  id: string;
  name: string;
  coverUrl: string | null;
  isPublic: boolean;
}

export interface PickerOption {
  key: string;
  destination: EmbeddedTagDestination;
  /** The second line: whose it is, or what kind. */
  subtitle: string;
}

/**
 * One list from the three searches: profiles, products and public projects,
 * anyone's. Never a post — a post is not a Destination (ONE-83) — and never a
 * private project, which the database would refuse (ONE-44).
 */
export const pickerOptions = (
  profiles: PickerProfile[],
  products: PickerProduct[],
  projects: PickerProject[],
): PickerOption[] => [
  ...profiles.map((p) => ({
    key: `profile-${p.id}`,
    subtitle: `@${p.username} · ${p.profileType === 'business' ? 'Business Profile' : 'Individual Profile'}`,
    destination: {
      kind: 'profile' as const,
      profileId: p.id,
      username: p.username,
      profileType: p.profileType,
      name: p.name,
      imageUrl: p.avatarUrl,
    },
  })),
  ...products.map((p) => ({
    key: `product-${p.id}`,
    subtitle: p.businessName ? `Product · ${p.businessName}` : 'Product',
    destination: { kind: 'product' as const, productId: p.id, name: p.name, imageUrl: p.imageUrl },
  })),
  ...projects
    .filter((p) => p.isPublic)
    .map((p) => ({
      key: `project-${p.id}`,
      subtitle: 'Project',
      destination: { kind: 'project' as const, projectId: p.id, name: p.name, imageUrl: p.coverUrl },
    })),
];

/** What the author is told when the post went out and its tags did not. */
export const TAGS_FAILED_TITLE = 'Your post is up, but its tags didn’t save';
export const TAGS_FAILED_MESSAGE = 'Try again to add them, or leave the post without tags.';
