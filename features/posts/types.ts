// Domain types for posts.
//
// `Post` stays in the repo-root `types.ts` for now — it is shared vocabulary
// and most screens still import it from there. Re-exported so callers can
// take everything about the domain from `features/posts`, and so there is one
// obvious place to move the definition to when the root file is broken up.

export type { Post } from '../../types';
