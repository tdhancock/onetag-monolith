/**
 * @jest-environment jsdom
 */
//
// target: __tests__/features/profiles/createProfile.test.tsx
//
// Adding a profile to an account (ONE-26), in the data layer:
//
//   1. The insert carries the account, a fresh id (the database's default),
//      the kind, handle, name and bio — and a business profile gets its
//      business row in the same flow.
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
}), { virtual: true });

const mockFrom = jest.fn();
jest.mock('../../../services/supabase.native', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args), auth: { getUser: jest.fn() } },
}), { virtual: true });

jest.mock('../../../features/auth', () => ({ useAuthUserId: () => 'auth-x' }), { virtual: true });

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createProfile,
  createProfileFailureFor,
  CreateProfileError,
  PROFILE_SELECT,
} from '../../../features/profiles/api';
import { useCreateProfile } from '../../../features/profiles/mutations';
import { activeProfileKeys, profileKeys } from '../../../features/profiles/keys';
import { activeProfileStorageKey } from '../../../features/profiles/activeProfile';
import { asAuthUserId } from '../../../types';

const ACCOUNT = asAuthUserId('auth-x');

const INDIVIDUAL_ROW = { id: 'p-ind', user_id: ACCOUNT, profile_type: 'individual', username: 'ana', full_name: 'Ana', bio: null };
const BUSINESS_ROW = { id: 'p-new', user_id: ACCOUNT, profile_type: 'business', username: 'ana_studio', full_name: 'Ana Studio', bio: null, business_profiles: null };

/** A fake `supabase.from`, recording each table's writes. */
function fakeDatabase(options: {
  profileInsert?: { data: unknown; error: unknown };
  businessInsert?: { error: unknown };
  mine?: unknown[];
} = {}) {
  const writes: { table: string; row: Record<string, unknown>; select?: string }[] = [];
  mockFrom.mockImplementation((table: string) => {
    if (table === 'business_profiles') {
      return {
        insert: (row: Record<string, unknown>) => {
          writes.push({ table, row });
          return Promise.resolve(options.businessInsert ?? { error: null });
        },
      };
    }
    return {
      insert: (row: Record<string, unknown>) => {
        const write: { table: string; row: Record<string, unknown>; select?: string } = { table, row };
        writes.push(write);
        return {
          select: (columns: string) => {
            write.select = columns;
            return { single: () => Promise.resolve(options.profileInsert ?? { data: BUSINESS_ROW, error: null }) };
          },
        };
      },
      select: () => ({ eq: () => Promise.resolve({ data: options.mine ?? [INDIVIDUAL_ROW, BUSINESS_ROW], error: null }) }),
    };
  });
  return writes;
}

beforeEach(() => {
  mockStore.clear();
  mockFrom.mockReset();
});

// ─── 1. The insert ──────────────────────────────────────────────────────

describe('createProfile', () => {
  it('inserts the profile for the account, then its business row', async () => {
    const writes = fakeDatabase();
    const created = await createProfile(ACCOUNT, {
      profileType: 'business',
      username: 'ana_studio',
      fullName: 'Ana Studio',
      bio: 'Ceramics.',
    });

    expect(writes[0]).toEqual({
      table: 'profiles',
      row: { user_id: ACCOUNT, profile_type: 'business', username: 'ana_studio', full_name: 'Ana Studio', bio: 'Ceramics.' },
      select: PROFILE_SELECT,
    });
    // No id is sent: the row takes a fresh one from the database.
    expect(writes[0].row).not.toHaveProperty('id');
    expect(writes[1]).toEqual({ table: 'business_profiles', row: { profile_id: 'p-new' } });

    expect(created.id).toBe('p-new');
    expect(created.profileType).toBe('business');
    expect(created.business).toEqual({ category: null, website: null, location: null, logoUrl: null });
  });

  it('adds no business row for an individual profile', async () => {
    const writes = fakeDatabase({ profileInsert: { data: { ...INDIVIDUAL_ROW, id: 'p-ind-2' }, error: null } });
    await createProfile(ACCOUNT, { profileType: 'individual', username: 'ana2', fullName: 'Ana' });
    expect(writes.map((w) => w.table)).toEqual(['profiles']);
    expect(writes[0].row.bio).toBeNull();
  });

  it('keeps the new profile when only its business row failed — saving its fields creates the row', async () => {
    fakeDatabase({ businessInsert: { error: { code: '500', message: 'boom' } } });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const created = await createProfile(ACCOUNT, { profileType: 'business', username: 'ana_studio', fullName: 'Ana Studio' });
    spy.mockRestore();
    expect(created.id).toBe('p-new');
    expect(created.business).toBeNull();
  });
});

// ─── 2. The refusals ────────────────────────────────────────────────────

describe('a refused insert', () => {
  const duplicate = (constraint: string) => ({
    code: '23505',
    message: `duplicate key value violates unique constraint "${constraint}"`,
  });

  it('says the handle is taken when the handle index refuses it — the race after the check', async () => {
    fakeDatabase({ profileInsert: { data: null, error: duplicate('profiles_username_lower_key') } });
    const attempt = createProfile(ACCOUNT, { profileType: 'business', username: 'taken', fullName: 'X' });
    await expect(attempt).rejects.toBeInstanceOf(CreateProfileError);
    await expect(attempt).rejects.toMatchObject({ reason: 'handle-taken', message: 'That handle is taken.' });
  });

  it('says the kind is taken when the one-of-each index refuses it', async () => {
    fakeDatabase({ profileInsert: { data: null, error: duplicate('profiles_one_per_type') } });
    await expect(
      createProfile(ACCOUNT, { profileType: 'business', username: 'fresh', fullName: 'X' }),
    ).rejects.toMatchObject({ reason: 'kind-taken' });
  });

  it('writes no business row when the profile was refused', async () => {
    const writes = fakeDatabase({ profileInsert: { data: null, error: duplicate('profiles_one_per_type') } });
    await expect(createProfile(ACCOUNT, { profileType: 'business', username: 'fresh', fullName: 'X' })).rejects.toThrow();
    expect(writes.map((w) => w.table)).toEqual(['profiles']);
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
