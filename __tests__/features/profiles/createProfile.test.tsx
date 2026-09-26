/**
 * @jest-environment jsdom
 */
//
// target: __tests__/features/profiles/createProfile.test.tsx
//
// Adding a profile to an account (ONE-26), in the data layer:
//
//   1. One call to the create_profile function (ONE-80) carries the kind,
//      handle, name and bio. The function takes the account from the session
//      and writes a business profile's business row in the same transaction,
//      so the client sends no account and makes no second insert.
//   2. The two unique indexes that can refuse it come back as reasons a
//      screen can say something about, never as a raw database error.
//   3. On success the new profile is in the account's list and is the one
//      being acted as.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => (mockStore.has(key) ? mockStore.get(key)! : null)),
    setItem: jest.fn(async (key: string, value: string) => { mockStore.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStore.delete(key); }),
    getAllKeys: jest.fn(async () => [...mockStore.keys()]),
  },
}));

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock('../../../services/supabase.native', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: { getUser: jest.fn() },
  },
}));

jest.mock('../../../features/auth', () => ({ useAuthUserId: () => 'auth-x' }));

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createProfile,
  createProfileFailureFor,
  CreateProfileError,
} from '../../../features/profiles/api';
import { useCreateProfile } from '../../../features/profiles/mutations';
import { activeProfileKeys, profileKeys } from '../../../features/profiles/keys';
import { activeProfileStorageKey } from '../../../features/profiles/activeProfile';
import { asAuthUserId } from '../../../types';

const ACCOUNT = asAuthUserId('auth-x');

const INDIVIDUAL_ROW = { id: 'p-ind', user_id: ACCOUNT, profile_type: 'individual', username: 'ana', full_name: 'Ana', bio: null };
const BUSINESS_ROW = { id: 'p-new', user_id: ACCOUNT, profile_type: 'business', username: 'ana_studio', full_name: 'Ana Studio', bio: null };

/** A fake database: `rpc` records each call, `from` serves the account's list. */
function fakeDatabase(options: {
  created?: { data: unknown; error: unknown };
  mine?: unknown[];
} = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const writes: string[] = [];
  mockRpc.mockImplementation((fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return Promise.resolve(options.created ?? { data: BUSINESS_ROW, error: null });
  });
  mockFrom.mockImplementation((table: string) => ({
    insert: () => {
      writes.push(table);
      return Promise.resolve({ error: null });
    },
    select: () => ({ eq: () => Promise.resolve({ data: options.mine ?? [INDIVIDUAL_ROW, BUSINESS_ROW], error: null }) }),
  }));
  return { calls, writes };
}

beforeEach(() => {
  mockStore.clear();
  mockFrom.mockReset();
  mockRpc.mockReset();
});

// ─── 1. The call ────────────────────────────────────────────────────────

describe('createProfile', () => {
  it('creates the profile and its business row in one create_profile call', async () => {
    const { calls, writes } = fakeDatabase();
    const created = await createProfile({
      profileType: 'business',
      username: 'ana_studio',
      fullName: 'Ana Studio',
      bio: 'Ceramics.',
    });

    expect(calls).toEqual([{
      fn: 'create_profile',
      args: { p_profile_type: 'business', p_username: 'ana_studio', p_full_name: 'Ana Studio', p_bio: 'Ceramics.' },
    }]);
    // The account comes from the session inside the function, and the row
    // takes a fresh id from the database: neither is sent.
    expect(calls[0].args).not.toHaveProperty('p_user_id');
    expect(calls[0].args).not.toHaveProperty('p_id');
    // No second request: the business row is written in the same transaction.
    expect(writes).toEqual([]);

    expect(created.id).toBe('p-new');
    expect(created.profileType).toBe('business');
    expect(created.business).toEqual({ category: null, website: null, location: null, logoUrl: null });
  });

  it('sends a null bio when there is none, and gives an individual profile no business fields', async () => {
    const { calls } = fakeDatabase({ created: { data: { ...INDIVIDUAL_ROW, id: 'p-ind-2' }, error: null } });
    const created = await createProfile({ profileType: 'individual', username: 'ana2', fullName: 'Ana' });
    expect(calls[0].args.p_bio).toBeNull();
    expect(created.business).toBeUndefined();
  });
});

// ─── 2. The refusals ────────────────────────────────────────────────────

describe('a refused insert', () => {
  const duplicate = (constraint: string) => ({
    code: '23505',
    message: `duplicate key value violates unique constraint "${constraint}"`,
  });

  it('says the handle is taken when the handle index refuses it — the race after the check', async () => {
    fakeDatabase({ created: { data: null, error: duplicate('profiles_username_lower_key') } });
    const attempt = createProfile({ profileType: 'business', username: 'taken', fullName: 'X' });
    await expect(attempt).rejects.toBeInstanceOf(CreateProfileError);
    await expect(attempt).rejects.toMatchObject({ reason: 'handle-taken', message: 'That handle is taken.' });
  });

  it('says the kind is taken when the one-of-each index refuses it', async () => {
    fakeDatabase({ created: { data: null, error: duplicate('profiles_one_per_type') } });
    await expect(
      createProfile({ profileType: 'business', username: 'fresh', fullName: 'X' }),
    ).rejects.toMatchObject({ reason: 'kind-taken' });
  });

  it('says the creation failed when the function refuses a caller with no session', async () => {
    fakeDatabase({ created: { data: null, error: { code: '42501', message: 'create_profile needs a signed-in account' } } });
    await expect(
      createProfile({ profileType: 'individual', username: 'fresh', fullName: 'X' }),
    ).rejects.toMatchObject({ reason: 'failed' });
  });

  it.each([
    [{ code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_lower_key"' }, 'handle-taken'],
    [{ code: '23505', details: 'Key (user_id, profile_type)=(…) already exists.', message: 'profiles_one_per_type' }, 'kind-taken'],
    [{ code: '42501', message: 'new row violates row-level security policy' }, 'failed'],
    [null, 'failed'],
  ])('reads %j as %s', (error, reason) => {
    expect(createProfileFailureFor(error)).toBe(reason);
  });
});

// ─── 3. After success ───────────────────────────────────────────────────

describe('useCreateProfile', () => {
  it("puts the new profile in the account's list and makes it the one being acted as", async () => {
    fakeDatabase();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    client.setQueryData(profileKeys.mine(ACCOUNT), [{ id: 'p-ind', username: 'ana', name: 'Ana', bio: '', profilePicture: null, profileType: 'individual' }]);
    client.setQueryData(activeProfileKeys.forAccount(ACCOUNT), null);

    let create: ReturnType<typeof useCreateProfile> | null = null;
    const Probe = () => {
      create = useCreateProfile();
      return null;
    };
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));

    await act(async () => {
      await create!.mutateAsync({ profileType: 'business', username: 'ana_studio', fullName: 'Ana Studio' });
    });

    const mine = client.getQueryData<{ id: string }[]>(profileKeys.mine(ACCOUNT))!;
    expect(mine.map((p) => p.id)).toContain('p-new');
    expect(client.getQueryData(activeProfileKeys.forAccount(ACCOUNT))).toBe('p-new');
    expect(JSON.parse(mockStore.get(activeProfileStorageKey(ACCOUNT))!)).toBe('p-new');

    act(() => root.unmount());
  });
});
