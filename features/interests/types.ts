// Domain types for interests (ONE-49).

/** One of the fixed, server-defined interest categories. */
export interface Interest {
  /** Stable: stored on posts and projects, and never renamed. */
  slug: string;
  name: string;
}
