// Domain types for hashtags.
//
// `Hashtag` stays in the repo-root `types.ts` for now: it is part of the
// shared vocabulary and several screens still import it from there. This file
// re-exports it so callers can take everything about the domain from
// `features/hashtags` without a second import path, and so there is a single
// obvious place to move the definition to when the root file is finally
// broken up.

export type { Hashtag } from '../../types';
