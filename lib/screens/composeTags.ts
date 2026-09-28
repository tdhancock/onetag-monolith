// Pure logic for placing Embedded Tags in the composer (ONE-46), and for
// editing them on a published post (ONE-92).
//
// A post does not exist until it is published, but a tag needs its host post
// (ONE-44). So tags are drafts in the composer's own state, positioned in
// percent of the picture's content from the moment they are placed, and are
// written only once the post insert has returned its id.
//
// Editing starts from the post's saved tags as drafts, and saving writes only
// the difference, so a tag that is merely moved keeps its id and its scans.

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

// ─── Editing a published post's tags (ONE-92) ───────────────────────────

/**
 * The post's saved tags as drafts. Each keeps its id as its key — a new
 * draft's key is `draft-N`, never an id — which is how the diff tells a saved
 * tag from a new one.
 */
export const seedDrafts = (tags: readonly EmbeddedTag[]): DraftTag[] =>
  tags.map((t) => ({ key: t.id, xPct: t.xPct, yPct: t.yPct, destination: t.destination }));

type Placed = DraftTag & { destination: EmbeddedTagDestination };

/** What saving has to write to turn the saved tags into the drafts. */
export interface TagEdits {
  /** New tags, and re-pointed ones, which are new tags. `key` is the draft's. */
  insert: { key: string; draft: Placed }[];
  /** Saved tags that only moved. They keep their ids. */
  move: { id: string; xPct: number; yPct: number }[];
  /** Saved tags that were removed, or re-pointed. */
  remove: string[];
}

const sameDestination = (a: EmbeddedTagDestination, b: EmbeddedTagDestination): boolean => {
  const x = destinationRef(a);
  const y = destinationRef(b);
  return x.kind === y.kind && x.id === y.id;
};

/**
 * The difference between the saved tags and the drafts. A tag's destination
 * can't change once it is written (`protect_tag_identity`), so one whose
 * destination changed is removed and inserted again. An unchanged tag is left
 * alone.
 */
export const diffTags = (saved: readonly EmbeddedTag[], drafts: readonly DraftTag[]): TagEdits => {
  const savedById = new Map(saved.map((t) => [t.id, t]));
  const kept = new Set<string>();
  const edits: TagEdits = { insert: [], move: [], remove: [] };

  for (const draft of withDestinations([...drafts])) {
    const original = savedById.get(draft.key);
    if (!original || !sameDestination(original.destination, draft.destination)) {
      edits.insert.push({ key: draft.key, draft });
      continue;
    }
    kept.add(original.id);
    if (original.xPct !== draft.xPct || original.yPct !== draft.yPct) {
      edits.move.push({ id: original.id, xPct: draft.xPct, yPct: draft.yPct });
    }
  }

  edits.remove = saved.filter((t) => !kept.has(t.id)).map((t) => t.id);
  return edits;
};

export const hasTagEdits = (edits: TagEdits): boolean =>
  edits.insert.length + edits.move.length + edits.remove.length > 0;

/** How saving reaches the database. Features supply it; this file stays pure. */
export interface TagWriter {
  /** Insert in one statement, resolving to the new ids in the order given. */
  insert: (tags: ReturnType<typeof tagsToWrite>) => Promise<string[]>;
  /** Move a saved tag. Resolves false when it is already gone. */
  move: (tagId: string, xPct: number, yPct: number) => Promise<boolean>;
  /** Delete a saved tag. A tag already gone is not an error. */
  remove: (tagId: string) => Promise<void>;
}

/**
 * Write the edits: inserts first, then moves, then removals, so a failure
 * never leaves the post with fewer tags than intended.
 *
 * After each step `onSaved` hears what the post now holds and the drafts
 * re-keyed to match. A failure part way through then leaves the screen
 * diffing against what the server really has, so saving again never inserts
 * a tag twice.
 *
 * A tag the destination's owner removed while this was open (ONE-44) is just
 * gone: moving or removing it is no error, and it leaves the drafts too.
 */
export const saveTagEdits = async (
  saved: readonly EmbeddedTag[],
  drafts: readonly DraftTag[],
  writer: TagWriter,
  onSaved: (saved: EmbeddedTag[], drafts: DraftTag[]) => void,
): Promise<void> => {
  const edits = diffTags(saved, drafts);
  let nowSaved = [...saved];
  let nowDrafts = [...drafts];

  if (edits.insert.length > 0) {
    const ids = await writer.insert(
      edits.insert.map(({ draft }) => ({ destination: destinationRef(draft.destination), xPct: draft.xPct, yPct: draft.yPct })),
    );
    if (ids.length !== edits.insert.length) throw new Error('The tags were saved without their ids.');

    // A re-pointed draft still carries the old tag's id as its key. Re-keyed
    // to its new id, the old tag is left in `saved` with no draft: a removal.
    const newKey = new Map(edits.insert.map(({ key }, i) => [key, ids[i]!]));
    nowDrafts = nowDrafts.map((d) => (newKey.has(d.key) ? { ...d, key: newKey.get(d.key)! } : d));
    nowSaved = [
      ...nowSaved,
      ...edits.insert.map(({ draft }, i) => ({ id: ids[i]!, xPct: draft.xPct, yPct: draft.yPct, destination: draft.destination })),
    ];
    onSaved(nowSaved, nowDrafts);
  }

  for (const { id, xPct, yPct } of edits.move) {
    const found = await writer.move(id, xPct, yPct);
    nowSaved = found
      ? nowSaved.map((t) => (t.id === id ? { ...t, xPct, yPct } : t))
      : nowSaved.filter((t) => t.id !== id);
    if (!found) nowDrafts = nowDrafts.filter((d) => d.key !== id);
    onSaved(nowSaved, nowDrafts);
  }

  for (const id of edits.remove) {
    await writer.remove(id);
    nowSaved = nowSaved.filter((t) => t.id !== id);
    onSaved(nowSaved, nowDrafts);
  }
};

/**
 * What the author is told when the database refuses a tag: a private project,
 * or a destination across a block either way (ONE-44, ONE-93). The picker
 * offers neither, so this is a race — the project went private, or a block
 * landed, while the screen was open.
 */
export const TAG_REFUSED_MESSAGE = 'One of those tags can’t be placed any more. Remove it and try again.';

/** Whether a failed save was RLS refusing a tag, rather than a network or server error. */
export const isTagRefusal = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '42501';
