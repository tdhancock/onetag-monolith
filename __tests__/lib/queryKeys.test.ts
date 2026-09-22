//
// target: __tests__/lib/queryKeys.test.ts
// The query key factory — lib/queryKeys.
//
// The shape is only worth having because of one property: a key higher in the
// hierarchy invalidates everything beneath it. That property is what lets a
// mutation choose how widely to invalidate without anyone reasoning about
// array prefixes at the call site, so it is asserted here against a real
// QueryClient rather than by comparing arrays.

import { QueryClient } from '@tanstack/react-query';

import { createQueryKeys } from '../../lib/queryKeys';

const postKeys = createQueryKeys('posts');

// ─── 1. The shape ───────────────────────────────────────────────────────

describe('createQueryKeys — shape', () => {
  it('builds the documented key shape', () => {
    expect(postKeys.all).toEqual(['posts']);
    expect(postKeys.lists()).toEqual(['posts', 'list']);
    expect(postKeys.list({ userId: 'u1' })).toEqual(['posts', 'list', { userId: 'u1' }]);
    expect(postKeys.details()).toEqual(['posts', 'detail']);
    expect(postKeys.detail('p1')).toEqual(['posts', 'detail', 'p1']);
  });

  it('nests every key under all, so containment is structural', () => {
    // lists() and details() are built from all rather than repeating the
    // domain string — a typo cannot silently detach a branch.
    for (const key of [postKeys.lists(), postKeys.details(), postKeys.detail('p1')]) {
      expect(key.slice(0, postKeys.all.length)).toEqual([...postKeys.all]);
    }
  });

  it('keeps domains apart', () => {
    const tagKeys = createQueryKeys('tags');
    expect(tagKeys.all).toEqual(['tags']);
    expect(tagKeys.lists()[0]).not.toBe(postKeys.lists()[0]);
  });

  it('treats different filters as different keys', () => {
    expect(postKeys.list({ userId: 'u1' })).not.toEqual(postKeys.list({ userId: 'u2' }));
  });
});

// ─── 2. Hierarchical invalidation — the acceptance criterion ────────────

describe('createQueryKeys — hierarchical invalidation', () => {
  const seed = () => {
    const client = new QueryClient();
    client.setQueryData(postKeys.list('u1'), ['a']);
    client.setQueryData(postKeys.detail('p1'), { id: 'p1' });
    return client;
  };

  /** A query is invalidated when TanStack has marked it stale. */
  const isInvalidated = (client: QueryClient, key: readonly unknown[]) =>
    client.getQueryState(key)?.isInvalidated === true;

  it('invalidating all reaches both a cached list and a cached detail', () => {
    // The acceptance criterion, stated in its own terms.
    const client = seed();
    expect(isInvalidated(client, postKeys.list('u1'))).toBe(false);
    expect(isInvalidated(client, postKeys.detail('p1'))).toBe(false);

    client.invalidateQueries({ queryKey: postKeys.all });

    expect(isInvalidated(client, postKeys.list('u1'))).toBe(true);
    expect(isInvalidated(client, postKeys.detail('p1'))).toBe(true);
  });

  it('invalidating lists leaves cached details alone', () => {
    // This is the point of the hierarchy: a mutation that only changes a
    // listing should not throw away every loaded detail page.
    const client = seed();
    client.invalidateQueries({ queryKey: postKeys.lists() });

    expect(isInvalidated(client, postKeys.list('u1'))).toBe(true);
    expect(isInvalidated(client, postKeys.detail('p1'))).toBe(false);
  });

  it('invalidating details leaves cached lists alone', () => {
    const client = seed();
    client.invalidateQueries({ queryKey: postKeys.details() });

    expect(isInvalidated(client, postKeys.list('u1'))).toBe(false);
    expect(isInvalidated(client, postKeys.detail('p1'))).toBe(true);
  });

  it('invalidating one detail leaves its siblings alone', () => {
    const client = seed();
    client.setQueryData(postKeys.detail('p2'), { id: 'p2' });

    client.invalidateQueries({ queryKey: postKeys.detail('p1') });

    expect(isInvalidated(client, postKeys.detail('p1'))).toBe(true);
    expect(isInvalidated(client, postKeys.detail('p2'))).toBe(false);
  });

  it('does not reach across domains', () => {
    const client = seed();
    const tagKeys = createQueryKeys('tags');
    client.setQueryData(tagKeys.lists(), ['x']);

    client.invalidateQueries({ queryKey: postKeys.all });

    expect(isInvalidated(client, tagKeys.lists())).toBe(false);
  });
});
