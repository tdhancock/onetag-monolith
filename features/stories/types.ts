// Domain types for stories — OneSnaps in user-facing copy.
//
// The table, its columns and the existing identifiers keep the name
// `stories`; only new UI strings say OneSnap (ONE-19). `Story` stays in the
// repo-root `types.ts` with the rest of the shared vocabulary.

import type { ProfileId, Story } from '../../types';

export type { Story };

/** Someone who has seen a story, as the owner's viewer list shows them. */
export interface StoryViewer {
  user_id: string;
  username: string;
  avatar_url: string | null;
}

/** Who a new story is attributed to, for the optimistic entry. */
export interface StoryAuthor {
  /** The profile the story is posted as. */
  id: ProfileId;
  username: string;
  avatar: string | null;
}

/** What an upload needs: an image, or text on its own. */
export interface UploadStoryInput {
  /** A local image URI. Absent for a text-only story. */
  imageUri?: string;
  /** The caption on an image story, or the whole of a text story. */
  caption?: string | null;
  /** A text story's gradient: a key into `oneSnapGradients`. Ignored with an image. */
  background?: string | null;
}
