// Domain types for Explore (ONE-47).

/** What kind of thing a grid cell is. Each routes to its own screen. */
export type ExploreKind = 'post' | 'product' | 'project';

/** One cell of the Explore grid. */
export interface ExploreItem {
  kind: ExploreKind;
  id: string;
  /** `kind:id` — unique across kinds, and the grid's list key. */
  key: string;
  ownerProfileId: string;
  ownerUsername: string;
  /** A post's text, or a product's or project's name. */
  title: string;
  imageUrl: string | null;
  /** 'text' for a post without a photo; everything else is 'image'. */
  mediaType: 'text' | 'image';
  /** Live embedded tags on a post; 0 for products and projects. */
  tagCount: number;
  /** The ordering score — see supabase/migrations/*_explore.sql. */
  score: number;
}

/** Where the next page starts: strictly after this row. Null for the first page. */
export type ExploreCursor = { score: number; key: string } | null;

/** A row of `explore_items`, as PostgREST returns it. */
export interface ExploreItemRow {
  kind: ExploreKind;
  id: string;
  item_key: string;
  owner_profile_id: string;
  owner_username: string;
  title: string | null;
  image_url: string | null;
  media_type: string | null;
  tag_count: number | null;
  created_at: string;
  score: number;
}
