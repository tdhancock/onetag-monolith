/**
 * @jest-environment jsdom
 */
//
// target: __tests__/features/profiles/activeProfile.test.tsx
//
// The active profile (ONE-24): which of an account's profiles it acts as.
// Attribution is the point — a post published under the wrong profile goes
// to the wrong audience and cannot be quietly repaired — so this suite pins:
//
//   1. The choice is stored per account, survives a restart, and is never
//      inherited by another account.
//   2. A stored id the account does not own is never acted as.
//   3. The switch refuses a foreign profile and moves the cached choice.
//   4. A switch resets everything cached for the previous profile and
//      nothing that belongs to the account.
//   5. A post published while acting as the business profile is attributed
//      to it — not to the first profile, not to the auth user.
//   6. A switch never touches push registration.

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
const mockGetUser = jest.fn();
jest.mock('../../../services/supabase.native', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
  },
}));

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  activeProfileStorageKey,
  chooseActiveProfile,
  isProfileScoped,
  isProfileSwitch,
  readActiveProfileId,
  resetProfileScopedQueries,
  useProfileSwitchReset,
} from '../../../features/profiles/activeProfile';
import { resolveCurrentProfile } from '../../../features/profiles/queries';
import { setActiveProfile } from '../../../features/profiles/mutations';
import { activeProfileKeys, profileKeys } from '../../../features/profiles/keys';
import { postKeys } from '../../../features/posts/keys';
import { publishPost } from '../../../features/posts/api';
import { notificationKeys } from '../../../features/notifications/keys';
import { messageKeys } from '../../../features/messages/keys';
import { storyKeys } from '../../../features/stories/keys';
import { commentKeys } from '../../../features/comments/keys';
import { authKeys } from '../../../features/auth/keys';
import { adminKeys } from '../../../features/admin/keys';
import { blockKeys } from '../../../features/blocks/keys';
import { ACCOUNT_SCOPED_ROOTS } from '../../../lib/queryClient';
import { asAuthUserId, asProfileId } from '../../../types';
import type { Post, UserProfile } from '../../../types';

// ─── Fixtures ───────────────────────────────────────────────────────────

const ACCOUNT = asAuthUserId('auth-x');
const OTHER_ACCOUNT = asAuthUserId('auth-y');

const profile = (id: string, profileType: 'individual' | 'business'): UserProfile => ({
  id,
  userId: ACCOUNT,
  profileType,
  name: id,
  username: id,
  bio: '',
  profilePicture: null,
});

const INDIVIDUAL = profile('p-individual', 'individual');
const BUSINESS = profile('p-business', 'business');
const MINE = [INDIVIDUAL, BUSINESS];

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });

beforeEach(() => {
  mockStore.clear();
  mockFrom.mockReset();
  mockGetUser.mockReset();
});

// ─── 1. The stored choice ───────────────────────────────────────────────

describe('the stored choice', () => {
  it('is keyed per account, as the ticket names it', () => {
    expect(activeProfileStorageKey(ACCOUNT)).toBe('onetag-active-profile-auth-x');
  });

  it('survives a restart: a later read returns what the switch wrote', async () => {
    await setActiveProfile(seeded(), ACCOUNT, asProfileId(BUSINESS.id));
    // A fresh read is what a cold start does.
    expect(await readActiveProfileId(ACCOUNT)).toBe(BUSINESS.id);
  });

  it('is not applied to a different account signing in on the same device', async () => {
    await setActiveProfile(seeded(), ACCOUNT, asProfileId(BUSINESS.id));
    expect(await readActiveProfileId(OTHER_ACCOUNT)).toBeNull();
  });

  it('reads as no choice when nothing, or nothing usable, is stored', async () => {
    expect(await readActiveProfileId(ACCOUNT)).toBeNull();
    mockStore.set(activeProfileStorageKey(ACCOUNT), '{not json');
    expect(await readActiveProfileId(ACCOUNT)).toBeNull();
    mockStore.set(activeProfileStorageKey(ACCOUNT), JSON.stringify({ id: 'p-business' }));
    expect(await readActiveProfileId(ACCOUNT)).toBeNull();
  });
});

// ─── 2. Trusting it ─────────────────────────────────────────────────────

describe('which profile is acted as', () => {
  it('is the stored choice when the account owns it', () => {
    const current = resolveCurrentProfile(ACCOUNT, MINE, false, BUSINESS.id);
    expect(current.profileId).toBe(BUSINESS.id);
    expect(current.status).toBe('ready');
  });

  it("falls back to the Individual Profile for an id the account does not own, without erroring", () => {
    const current = resolveCurrentProfile(ACCOUNT, MINE, false, 'p-someone-elses');
    expect(current.profileId).toBe(INDIVIDUAL.id);
    expect(current.status).toBe('ready');
  });

  it('falls back to the Individual Profile whatever order the profiles arrive in', () => {
    expect(chooseActiveProfile([BUSINESS, INDIVIDUAL], null)?.id).toBe(INDIVIDUAL.id);
  });

  it('falls back to the first profile when the account has no Individual one', () => {
    expect(chooseActiveProfile([BUSINESS], 'p-deleted')?.id).toBe(BUSINESS.id);
  });

  it('acts as nobody while the stored choice is still being read', () => {
    const current = resolveCurrentProfile(ACCOUNT, MINE, true, undefined);
    expect(current.profileId).toBeUndefined();
    expect(current.status).toBe('loading');
  });
});

// ─── 3. The switch ──────────────────────────────────────────────────────

/** A client that already holds the account's profiles and no choice. */
function seeded(): QueryClient {
  const client = newClient();
  client.setQueryData(profileKeys.mine(ACCOUNT), MINE);
  client.setQueryData(activeProfileKeys.forAccount(ACCOUNT), null);
  return client;
}

describe('setActiveProfile', () => {
  it('moves the cached choice and remembers it', async () => {
    const client = seeded();
    await setActiveProfile(client, ACCOUNT, asProfileId(BUSINESS.id));

    expect(client.getQueryData(activeProfileKeys.forAccount(ACCOUNT))).toBe(BUSINESS.id);
    expect(JSON.parse(mockStore.get(activeProfileStorageKey(ACCOUNT))!)).toBe(BUSINESS.id);
  });

  it("refuses a profile the account does not own, even after re-reading the account's list", async () => {
    const client = seeded();
    mockFrom.mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) });

    await expect(setActiveProfile(client, ACCOUNT, asProfileId('p-someone-elses'))).rejects.toThrow(
      'That profile does not belong to this account.',
    );
    expect(client.getQueryData(activeProfileKeys.forAccount(ACCOUNT))).toBeNull();
    expect(mockStore.has(activeProfileStorageKey(ACCOUNT))).toBe(false);
  });

  it('accepts a profile created a moment ago, once the fresh list has it', async () => {
    const client = newClient();
    client.setQueryData(profileKeys.mine(ACCOUNT), [INDIVIDUAL]);
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => Promise.resolve({ data: [
        { id: INDIVIDUAL.id, user_id: ACCOUNT, profile_type: 'individual', username: 'i', full_name: 'I' },
        { id: BUSINESS.id, user_id: ACCOUNT, profile_type: 'business', username: 'b', full_name: 'B' },
      ], error: null }) }),
    });

    await setActiveProfile(client, ACCOUNT, asProfileId(BUSINESS.id));
    expect(client.getQueryData(activeProfileKeys.forAccount(ACCOUNT))).toBe(BUSINESS.id);
  });

  it('refuses when signed out', async () => {
    await expect(setActiveProfile(newClient(), undefined, asProfileId(BUSINESS.id))).rejects.toThrow('signed in');
  });
});

// ─── 4. What a switch resets ────────────────────────────────────────────

describe('the profile-scoped cache', () => {
  const PROFILE_SCOPED = [
    postKeys.feed(INDIVIDUAL.id),
    postKeys.detail('post-1'),
    notificationKeys.forUser(INDIVIDUAL.id),
    messageKeys.conversations(INDIVIDUAL.id),
    messageKeys.unread(INDIVIDUAL.id),
    storyKeys.reel(INDIVIDUAL.id),
    commentKeys.forPost('post-1'),
    profileKeys.followingUsernames(INDIVIDUAL.id),
    profileKeys.byUsername('ana'),
  ];
  const ACCOUNT_SCOPED = [
    profileKeys.mine(ACCOUNT),
    activeProfileKeys.forAccount(ACCOUNT),
    authKeys.session(),
    adminKeys.isAdmin(ACCOUNT),
    blockKeys.list(ACCOUNT),
  ];

  it('names every account-scoped root after a real key factory, so the list cannot drift', () => {
    expect([...ACCOUNT_SCOPED_ROOTS].sort()).toEqual(
      [authKeys.all[0], adminKeys.all[0], blockKeys.all[0], activeProfileKeys.all[0]].sort(),
    );
  });

  it.each(PROFILE_SCOPED.map((key) => [JSON.stringify(key), key]))('resets %s', (_name, key) => {
    expect(isProfileScoped(key)).toBe(true);
  });

  it.each(ACCOUNT_SCOPED.map((key) => [JSON.stringify(key), key]))('keeps %s', (_name, key) => {
    expect(isProfileScoped(key)).toBe(false);
  });

  it("empties the previous profile's feed, notifications and messages, and keeps the account's own", async () => {
    const client = newClient();
    for (const key of [...PROFILE_SCOPED, ...ACCOUNT_SCOPED]) client.setQueryData(key, ['cached']);

    await resetProfileScopedQueries(client);

    for (const key of PROFILE_SCOPED) expect(client.getQueryData(key)).toBeUndefined();
    for (const key of ACCOUNT_SCOPED) expect(client.getQueryData(key)).toEqual(['cached']);
  });
});

describe('isProfileSwitch', () => {
  const at = (authUserId?: string, profileId?: string) => ({ authUserId, profileId });

  it('is a switch when one account moves from one profile to another', () => {
    expect(isProfileSwitch(at('a', 'p1'), at('a', 'p2'))).toBe(true);
  });

  it.each([
    ['the first load', at(undefined, undefined), at('a', 'p1')],
    ['the profile still loading', at('a', undefined), at('a', 'p1')],
    ['the same profile again', at('a', 'p1'), at('a', 'p1')],
    ['signing out', at('a', 'p1'), at(undefined, undefined)],
    ['another account signing in', at('a', 'p1'), at('b', 'p9')],
  ])('is not a switch on %s', (_name, before, after) => {
    expect(isProfileSwitch(before, after)).toBe(false);
  });
});

describe('useProfileSwitchReset', () => {
  const Watcher: React.FC<{ authUserId?: string; profileId?: string }> = ({ authUserId, profileId }) => {
    useProfileSwitchReset(authUserId, profileId);
    return null;
  };

  const mount = (client: QueryClient) => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const render = (props: { authUserId?: string; profileId?: string }) =>
      act(() => root.render(
        <QueryClientProvider client={client}>
          <Watcher {...props} />
        </QueryClientProvider>,
      ));
    return { render, unmount: () => act(() => root.unmount()) };
  };

  it('resets the profile-scoped cache when the acting profile switches, and only then', () => {
    const client = newClient();
    const reset = jest.spyOn(client, 'resetQueries');
    const view = mount(client);

    view.render({ authUserId: ACCOUNT, profileId: INDIVIDUAL.id });
    expect(reset).not.toHaveBeenCalled();

    view.render({ authUserId: ACCOUNT, profileId: BUSINESS.id });
    expect(reset).toHaveBeenCalledTimes(1);

    // A moment with no profile (the list reloading) and back is not a switch.
    view.render({ authUserId: ACCOUNT, profileId: undefined });
    view.render({ authUserId: ACCOUNT, profileId: BUSINESS.id });
    expect(reset).toHaveBeenCalledTimes(1);

    // Signing out and into another account is left to sign-out's own clear.
    view.render({ authUserId: undefined, profileId: undefined });
    view.render({ authUserId: OTHER_ACCOUNT, profileId: 'p-other' });
    expect(reset).toHaveBeenCalledTimes(1);

    view.unmount();
  });
});

// ─── 5. Attribution ─────────────────────────────────────────────────────

describe('attribution', () => {
  it('publishes as the business profile while it is active — not the first profile, not the auth user', async () => {
    const acting = resolveCurrentProfile(ACCOUNT, MINE, false, BUSINESS.id);

    const inserted: Record<string, unknown>[] = [];
    mockGetUser.mockResolvedValue({ data: { user: { id: ACCOUNT, user_metadata: {}, email: 'x@one24.test' } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: INDIVIDUAL.id }], error: null }) }) }) };
      }
      return {
        insert: (rows: Record<string, unknown>[]) => {
          inserted.push(...rows);
          return { select: () => ({ single: async () => ({ data: { id: 'post-1' }, error: null }) }) };
        },
        select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'post-1', content: 'hi' }, error: null }) }) }),
      };
    });

    const draft = { id: 'temp', content: 'hi', username: 'b', avatar: null, media_type: 'text', likes: 0, reposts: 0, replies: 0 } as Post;
    await publishPost(draft, acting.profileId!);

    expect(inserted).toHaveLength(1);
    expect(inserted[0].user_id).toBe(BUSINESS.id);
    expect(inserted[0].user_id).not.toBe(INDIVIDUAL.id);
    expect(inserted[0].user_id).not.toBe(ACCOUNT);
  });
});

// ─── 6. Push tokens ─────────────────────────────────────────────────────

describe('push registration', () => {
  it('keys on the account, which a switch does not change', () => {
    const asIndividual = resolveCurrentProfile(ACCOUNT, MINE, false, INDIVIDUAL.id);
    const asBusiness = resolveCurrentProfile(ACCOUNT, MINE, false, BUSINESS.id);
    expect(asBusiness.profileId).not.toBe(asIndividual.profileId);
    expect(asBusiness.authUserId).toBe(asIndividual.authUserId);
  });

  it('registers from an effect that depends on the account alone, so a switch never re-registers', () => {
    const layout = readFileSync(join(__dirname, '..', '..', '..', 'app', '_layout.tsx'), 'utf8');
    const effect = layout.slice(layout.indexOf('registerForPushNotifications().then'));
    const deps = effect.slice(0, effect.indexOf(']);') + 3);
    expect(deps).toContain('savePushToken(authUserId, token)');
    expect(deps.trim().endsWith('}, [authUserId]);')).toBe(true);
  });
});
