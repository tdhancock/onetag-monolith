//
// target: __tests__/features/posts/cache.test.ts
// Realtime edits folded into the cached feed — features/posts/cache.
//
// The feed used to hold its posts in useState and the realtime subscription
// folded INSERT / UPDATE / DELETE into that array. The list is the query's
// data now, so those edits land in the cache instead. These are the same
// three user-visible behaviours the old reducer guaranteed:
//
//   1. A new post from someone I follow appears at the top.
//   2. A deleted post disappears.
//   3. A like count ticks without disturbing any other post.
//
// Plus the guard rails: a duplicate INSERT must not double-add, and an edit
// for a post that is not loaded must not invent one.

import type { InfiniteData } from '@tanstack/react-query';

import {
  feedPosts,
  prependPost,
  replacePost,
  removePost,
} from '../../../features/posts/cache';
import type { FeedData } from '../../../features/posts/cache';
import type { Post } from '../../../types';

const post = (id: string, likes = 0): Post =>
  ({ id, likes, username: 'layla', content: id, timestamp: `t-${id}` }) as Post;

const feed = (...pages: Post[][]): FeedData =>
  ({ pages, pageParams: pages.map(() => null) }) as InfiniteData<Post[], string | null>;

// ─── 1. Reading across pages ────────────────────────────────────────────

describe('feedPosts', () => {
  it('flattens every loaded page in order', () => {
    const data = feed([post('a'), post('b')], [post('c')]);
    expect(feedPosts(data).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('is empty before the first page arrives', () => {
    expect(feedPosts(undefined)).toEqual([]);
  });
});

// ─── 2. INSERT ──────────────────────────────────────────────────────────

describe('prependPost', () => {
  it('puts a newly published post at the top of the feed', () => {
    const next = prependPost(feed([post('a'), post('b')]), post('c'));
    expect(feedPosts(next).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('only touches the first page', () => {
    const next = prependPost(feed([post('a')], [post('b')]), post('c'));
    expect(next!.pages[0]!.map((p) => p.id)).toEqual(['c', 'a']);
    expect(next!.pages[1]!.map((p) => p.id)).toEqual(['b']);
  });

  it('ignores a post already in the feed rather than duplicating it', () => {
    // Realtime can deliver an INSERT for a post the reader already fetched.
    const data = feed([post('a')]);
    expect(prependPost(data, post('a'))).toBe(data);
  });

  it('finds a duplicate on a later page too', () => {
    const data = feed([post('a')], [post('b')]);
    expect(prependPost(data, post('b'))).toBe(data);
  });

  it('does nothing before the first page has arrived', () => {
    expect(prependPost(undefined, post('a'))).toBeUndefined();
    const empty = feed();
    expect(prependPost(empty, post('a'))).toBe(empty);
  });
});

// ─── 3. UPDATE ──────────────────────────────────────────────────────────

describe('replacePost', () => {
  it('ticks a like count without disturbing its neighbours', () => {
    const data = feed([post('a', 5), post('b', 2)]);
    const next = replacePost(data, post('a', 6));

    expect(feedPosts(next).find((p) => p.id === 'a')!.likes).toBe(6);
    expect(feedPosts(next).find((p) => p.id === 'b')!.likes).toBe(2);
  });

  it('replaces on whichever page holds the post', () => {
    const next = replacePost(feed([post('a')], [post('b', 1)]), post('b', 9));
    expect(next!.pages[1]![0]!.likes).toBe(9);
  });

  it('leaves untouched pages by reference, so they do not re-render', () => {
    const data = feed([post('a')], [post('b')]);
    const next = replacePost(data, post('b', 3));
    expect(next!.pages[0]).toBe(data.pages[0]);
    expect(next!.pages[1]).not.toBe(data.pages[1]);
  });

  it('does not invent a post that is not loaded', () => {
    const data = feed([post('a')]);
    expect(replacePost(data, post('zzz'))).toBe(data);
    expect(feedPosts(replacePost(data, post('zzz')))).toHaveLength(1);
  });
});

// ─── 4. DELETE ──────────────────────────────────────────────────────────

describe('removePost', () => {
  it('drops a deleted post from the feed', () => {
    const next = removePost(feed([post('a'), post('b'), post('c')]), 'b');
    expect(feedPosts(next).map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('removes from a later page', () => {
    const next = removePost(feed([post('a')], [post('b')]), 'b');
    expect(feedPosts(next).map((p) => p.id)).toEqual(['a']);
  });

  it('is a no-op for a post that is not loaded', () => {
    const data = feed([post('a')]);
    expect(removePost(data, 'nope')).toBe(data);
  });

  it('can empty the feed entirely', () => {
    expect(feedPosts(removePost(feed([post('a')]), 'a'))).toEqual([]);
  });
});

// ─── 5. Reference stability ─────────────────────────────────────────────

describe('cache transforms — reference stability', () => {
  it('return the same object when nothing changed', () => {
    // setQueryData with an unchanged reference is a no-op re-render; a fresh
    // array on every realtime event would re-render the whole list.
    const data = feed([post('a')]);
    expect(prependPost(data, post('a'))).toBe(data);
    expect(replacePost(data, post('b'))).toBe(data);
    expect(removePost(data, 'b')).toBe(data);
  });

  it('return a new object when something did change', () => {
    const data = feed([post('a')]);
    expect(prependPost(data, post('b'))).not.toBe(data);
    expect(replacePost(data, post('a', 1))).not.toBe(data);
    expect(removePost(data, 'a')).not.toBe(data);
  });

  it('never mutate the input', () => {
    const data = feed([post('a')]);
    const before = JSON.stringify(data);
    prependPost(data, post('b'));
    replacePost(data, post('a', 99));
    removePost(data, 'a');
    expect(JSON.stringify(data)).toBe(before);
  });
});
