// Pure transforms over the feed's cached pages.
//
// The feed screen subscribes to Postgres changes on `posts` and used to fold
// them into a local `useState` array. Now that the list is the query's data,
// those edits have to land in the cache instead — so the transforms live
// here, as pure functions, testable without a renderer or a live socket.
//
// ONE-16 generalizes the realtime-to-cache bridge across domains. These stay
// posts-specific until it does; the shape it needs is visible from here.
//
// Every function returns the *same reference* when nothing changed, so
// `setQueryData` is a no-op re-render rather than a new array each event.

import type { InfiniteData } from '@tanstack/react-query';
import type { FeedCursor } from './api';
import type { Post } from './types';

/** The cached shape of a feed: one array of posts per fetched page. */
export type FeedData = InfiniteData<Post[], FeedCursor>;

const isPost = (value: unknown): value is Post => {
  const v = value as Partial<Post> | null;
  return (
    typeof v === 'object' && v !== null &&
    typeof v.id === 'string' && typeof v.username === 'string' &&
    (v.media_type === 'text' || v.media_type === 'image') && typeof v.likes === 'number'
  );
};

/**
 * A post already held by a cached list — a feed's pages, a profile's grid —
 * so its own screen can show it at once while it loads in full. Undefined
 * when no list holds it.
 */
export const findCachedPost = (cached: readonly unknown[], postId: string): Post | undefined => {
  for (const data of cached) {
    const pages = (data as { pages?: unknown } | null)?.pages;
    const lists = Array.isArray(pages) ? pages : [data];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      const found = list.find((item) => isPost(item) && item.id === postId);
      if (found) return found as Post;
    }
  }
  return undefined;
};

/** Every post across every loaded page, in order. */
export const feedPosts = (data: FeedData | undefined): Post[] =>
  data ? data.pages.flat() : [];

const containsPost = (data: FeedData, postId: string): boolean =>
  data.pages.some((page) => page.some((post) => post.id === postId));

/**
 * Put a newly published post at the top of the first page.
 *
 * A post already in the feed is ignored rather than duplicated — realtime
 * can deliver an INSERT for a post the reader already fetched.
 */
export const prependPost = (data: FeedData | undefined, post: Post): FeedData | undefined => {
  if (!data || data.pages.length === 0) return data;
  if (containsPost(data, post.id)) return data;

  const [first, ...rest] = data.pages;
  return { ...data, pages: [[post, ...first!], ...rest] };
};

/** Replace a post wherever it sits, leaving the rest untouched. */
export const replacePost = (data: FeedData | undefined, post: Post): FeedData | undefined => {
  if (!data || !containsPost(data, post.id)) return data;

  return {
    ...data,
    pages: data.pages.map((page) =>
      page.some((p) => p.id === post.id)
        ? page.map((p) => (p.id === post.id ? post : p))
        : page,
    ),
  };
};

/** Drop a deleted post from whichever page holds it. */
export const removePost = (data: FeedData | undefined, postId: string): FeedData | undefined => {
  if (!data || !containsPost(data, postId)) return data;

  return {
    ...data,
    pages: data.pages.map((page) =>
      page.some((p) => p.id === postId) ? page.filter((p) => p.id !== postId) : page,
    ),
  };
};
