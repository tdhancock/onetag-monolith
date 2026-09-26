//
// target: __tests__/features/tags/resolve.test.ts
//
// Tag Resolution (ONE-30), without mounting anything:
//
//   1. resolveTag reads a short code through resolve_tag, anonymously, and
//      tells a live tag from a paused one from a code that does not exist —
//      and a network failure from a server one.
//   2. recordScan writes a scan against a profile or against nobody, without
//      reading the row back.
//   3. The route's decisions: where each destination kind goes, which state
//      the screen is in, and who a scan is attributed to.
//
// The mounted route is covered in __tests__/components/TagResolution.test.tsx.

const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock('../../../services/supabase.native', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { mapResolveTagRow, recordScan, resolveTag, TagResolutionError } from '../../../features/tags';
import type { ResolveTagRow, TagDestination } from '../../../features/tags';
import {
  FAILURE_COPY,
  onwardActionsFor,
  routeForDestination,
  scanAttributionFor,
  tagScreenFor,
} from '../../../lib/screens/tagResolution';
import { asProfileId } from '../../../types';

const LIVE: ResolveTagRow = {
  tag_id: 'tag-1',
  active: true,
  dest_profile_id: 'p-ana',
  dest_profile_username: 'ana',
};

/** A fake `supabase.rpc(...).maybeSingle()` answering with one result. */
function answer(result: { data: unknown; error: unknown; status: number }) {
  const maybeSingle = jest.fn(() => Promise.resolve(result));
  mockRpc.mockImplementation(() => ({ maybeSingle }));
  return maybeSingle;
}

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
});

// ─── 1. Resolving ───────────────────────────────────────────────────────

describe('resolveTag', () => {
  it('reads the code through resolve_tag', async () => {
    answer({ data: LIVE, error: null, status: 200 });
    await resolveTag('ABC23XYZ');
    expect(mockRpc).toHaveBeenCalledWith('resolve_tag', { p_short_code: 'ABC23XYZ' });
  });

  it('resolves a live profile tag to the profile', async () => {
    answer({ data: LIVE, error: null, status: 200 });
    await expect(resolveTag('ABC23XYZ')).resolves.toEqual({
      status: 'active',
      tagId: 'tag-1',
      destination: { kind: 'profile', profileId: 'p-ana', username: 'ana' },
    });
  });

  it('reads a paused tag as inactive — distinct from not-found', async () => {
    answer({ data: { tag_id: null, active: false, dest_profile_id: null, dest_profile_username: null }, error: null, status: 200 });
    await expect(resolveTag('ABC23XYZ')).resolves.toEqual({ status: 'inactive' });
  });

  it('reads an unknown code as not-found', async () => {
    answer({ data: null, error: null, status: 200 });
    await expect(resolveTag('ABC23XYZ')).resolves.toEqual({ status: 'not-found' });
  });

  it.each(['', 'abc', 'ABC23XYZ9', 'O0l1I234', "ABC'; --", '../../etc'])(
    'treats %j as not-found without a query — the path segment is hostile input',
    async (code) => {
      await expect(resolveTag(code)).resolves.toEqual({ status: 'not-found' });
      expect(mockRpc).not.toHaveBeenCalled();
    },
  );

  it('says offline when the request never reached the server', async () => {
    answer({ data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 });
    const attempt = resolveTag('ABC23XYZ');
    await expect(attempt).rejects.toBeInstanceOf(TagResolutionError);
    await expect(attempt).rejects.toMatchObject({ reason: 'offline' });
  });

  it('says failed when the server refused it', async () => {
    answer({ data: null, error: { message: 'boom', code: '500' }, status: 500 });
    await expect(resolveTag('ABC23XYZ')).rejects.toMatchObject({ reason: 'failed' });
  });

  it('needs no session — nothing but the rpc is touched', async () => {
    answer({ data: LIVE, error: null, status: 200 });
    await resolveTag('ABC23XYZ');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('mapResolveTagRow', () => {
  it('reads a live tag whose profile is gone as having nowhere to go', () => {
    expect(mapResolveTagRow({ ...LIVE, dest_profile_username: null })).toEqual({
      status: 'active',
      tagId: 'tag-1',
      destination: null,
    });
  });

  it('reads a live tag with no destination this build knows as having nowhere to go', () => {
    expect(mapResolveTagRow({ ...LIVE, dest_profile_id: null, dest_profile_username: null })).toMatchObject({
      destination: null,
    });
  });
});

// ─── 2. Recording ───────────────────────────────────────────────────────

describe('recordScan', () => {
  function fakeInsert(result: { error: unknown }) {
    const insert = jest.fn(() => Promise.resolve(result));
    mockFrom.mockImplementation(() => ({ insert }));
    return insert;
  }

  it('records an anonymous scan with a null scanner_profile_id', async () => {
    const insert = fakeInsert({ error: null });
    await recordScan('tag-1', null);
    expect(mockFrom).toHaveBeenCalledWith('scans');
    expect(insert).toHaveBeenCalledWith({ tag_id: 'tag-1', scanner_profile_id: null });
  });

  it('records a signed-in scan against the profile given', async () => {
    const insert = fakeInsert({ error: null });
    await recordScan('tag-1', asProfileId('p-biz'));
    expect(insert).toHaveBeenCalledWith({ tag_id: 'tag-1', scanner_profile_id: 'p-biz' });
  });

  it('does not read the row back — anon has no SELECT on scans', async () => {
    const insert = fakeInsert({ error: null });
    await recordScan('tag-1', null);
    // The fake's insert result has no .select: calling it would have thrown.
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('throws what the database refused, for the mutation to swallow', async () => {
    fakeInsert({ error: { code: '42501', message: 'row-level security' } });
    await expect(recordScan('tag-1', null)).rejects.toMatchObject({ code: '42501' });
  });
});

// ─── 3. The route's decisions ───────────────────────────────────────────

describe('routeForDestination', () => {
  it('sends a profile destination to its profile', () => {
    expect(routeForDestination({ kind: 'profile', profileId: 'p', username: 'ana' })).toBe('/user/ana');
  });

  it('escapes what goes into the path', () => {
    expect(routeForDestination({ kind: 'profile', profileId: 'p', username: 'a/b?c' })).toBe('/user/a%2Fb%3Fc');
  });

  it('returns null, rather than crashing, for a kind this build does not know', () => {
    expect(routeForDestination({ kind: 'product', productId: 'x' } as unknown as TagDestination)).toBeNull();
  });
});

describe('tagScreenFor', () => {
  const settled = { isFetching: false, isFetchedAfterMount: true };

  it('resolves while the first fetch is in flight', () => {
    expect(tagScreenFor({ isFetching: true, isFetchedAfterMount: false })).toEqual({ kind: 'resolving' });
  });

  it('never acts on a cached resolution from before it mounted', () => {
    const cached = { status: 'active', tagId: 'tag-1', destination: { kind: 'profile', profileId: 'p', username: 'ana' } } as const;
    expect(tagScreenFor({ data: cached, isFetching: true, isFetchedAfterMount: false })).toEqual({ kind: 'resolving' });
  });

  it('resolves again while a retry is in flight', () => {
    expect(tagScreenFor({ error: new TagResolutionError('offline'), isFetching: true, isFetchedAfterMount: true }))
      .toEqual({ kind: 'resolving' });
  });

  it('redirects a live tag to its destination', () => {
    expect(tagScreenFor({
      ...settled,
      data: { status: 'active', tagId: 'tag-1', destination: { kind: 'profile', profileId: 'p', username: 'ana' } },
    })).toEqual({ kind: 'redirect', tagId: 'tag-1', route: '/user/ana' });
  });

  it.each([
    [{ status: 'not-found' } as const, 'not-found'],
    [{ status: 'inactive' } as const, 'inactive'],
    [{ status: 'active', tagId: 'tag-1', destination: null } as const, 'destination-missing'],
  ])('shows %j as %s', (data, kind) => {
    expect(tagScreenFor({ ...settled, data })).toEqual({ kind });
  });

  it('shows offline for a request that never reached the server, and failed otherwise', () => {
    expect(tagScreenFor({ ...settled, error: new TagResolutionError('offline') })).toEqual({ kind: 'offline' });
    expect(tagScreenFor({ ...settled, error: new TagResolutionError('failed') })).toEqual({ kind: 'failed' });
    expect(tagScreenFor({ ...settled, error: new Error('???') })).toEqual({ kind: 'failed' });
  });
});

describe('scanAttributionFor', () => {
  const active = asProfileId('p-biz');

  it('attributes to nobody when signed out — resolution never needs a session', () => {
    expect(scanAttributionFor('signed-out', { status: 'signed-out', profileId: undefined }))
      .toEqual({ known: true, scannerProfileId: null });
  });

  it('attributes to the active profile when signed in', () => {
    expect(scanAttributionFor('signed-in', { status: 'ready', profileId: active }))
      .toEqual({ known: true, scannerProfileId: active });
  });

  it('waits while the session is not known yet, rather than guessing anonymous', () => {
    // A cold start from a scanned sticker: the profile hook says signed-out,
    // but only because the session has not arrived.
    expect(scanAttributionFor('unknown', { status: 'signed-out', profileId: undefined })).toEqual({ known: false });
  });

  it('waits while a signed-in account\'s active profile loads', () => {
    expect(scanAttributionFor('signed-in', { status: 'loading', profileId: undefined })).toEqual({ known: false });
  });

  it('attributes to nobody for a signed-in account with no profile', () => {
    expect(scanAttributionFor('signed-in', { status: 'missing', profileId: undefined }))
      .toEqual({ known: true, scannerProfileId: null });
  });
});

describe('every failure has somewhere to go', () => {
  it('offers the app when signed in', () => {
    expect(onwardActionsFor('signed-in')).toEqual({ primary: { label: 'Go to OneTag', route: '/(tabs)' } });
  });

  it.each(['signed-out', 'unknown'] as const)('offers sign up and sign in when %s', (auth) => {
    expect(onwardActionsFor(auth)).toEqual({
      primary: { label: 'Join OneTag', route: '/(auth)/signup' },
      secondary: { label: 'Sign in', route: '/(auth)/login' },
    });
  });

  it('says what the ticket says for the two states a stranger most often meets', () => {
    expect(FAILURE_COPY['not-found'].title).toBe("This tag isn't recognized.");
    expect(FAILURE_COPY.inactive.title).toBe('This tag is no longer active.');
  });

  it('offers a retry only where trying again could help', () => {
    expect(Object.entries(FAILURE_COPY).filter(([, c]) => c.retry).map(([k]) => k).sort()).toEqual(['failed', 'offline']);
  });
});
