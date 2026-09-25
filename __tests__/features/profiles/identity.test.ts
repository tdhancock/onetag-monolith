//
// target: __tests__/features/profiles/identity.test.ts
//
// Auth user id versus profile id (ONE-22). Since ONE-21 an account and a
// profile are different things with different ids; conflating them
// attributes a post to the wrong profile, or silently fetches nothing.
//
// Two layers:
//   1. Types. `AuthUserId` and `ProfileId` are branded, so passing one where
//      the other is wanted is a compile error. The `@ts-expect-error` lines
//      below are the test: `npx tsc --noEmit` fails if any of them stops
//      being an error.
//   2. Which profile the app acts as, and what it does when there is none.

jest.mock('../../../services/supabase.native', () => ({ supabase: {} }), { virtual: true });
jest.mock('../../../features/auth', () => ({ useAuthUserId: () => undefined }), { virtual: true });

import { resolveCurrentProfile, PLACEHOLDER_PROFILE } from '../../../features/profiles/queries';
import { asAuthUserId, asProfileId } from '../../../types';
import type { AuthUserId, ProfileId, UserProfile } from '../../../types';

// ─── 1. The brands ──────────────────────────────────────────────────────

const takesProfile = (id: ProfileId) => id;
const takesAccount = (id: AuthUserId) => id;

describe('identity types', () => {
  it('refuse to pass an account id where a profile id is wanted, and vice versa', () => {
    const account = asAuthUserId('auth-1');
    const profile = asProfileId('profile-1');

    // @ts-expect-error — an auth user id is not a profile id.
    takesProfile(account);
    // @ts-expect-error — a profile id is not an auth user id.
    takesAccount(profile);
    // @ts-expect-error — an unbranded string is neither, until someone says so.
    takesProfile('profile-1');

    expect(takesProfile(profile)).toBe('profile-1');
    expect(takesAccount(account)).toBe('auth-1');
  });

  it('are plain strings at runtime', () => {
    expect(typeof asProfileId('p')).toBe('string');
    expect(asAuthUserId('a')).toBe('a');
  });
});

// ─── 2. The current profile ─────────────────────────────────────────────

const ACCOUNT = asAuthUserId('auth-1');

const profile = (id: string, profileType: UserProfile['profileType']): UserProfile => ({
  id,
  userId: ACCOUNT,
  profileType,
  name: id,
  username: id,
  bio: '',
  profilePicture: null,
});

describe('resolveCurrentProfile', () => {
  it('is signed out without a session', () => {
    const current = resolveCurrentProfile(undefined, undefined, false);
    expect(current.status).toBe('signed-out');
    expect(current.profileId).toBeUndefined();
    expect(current.profile).toBe(PLACEHOLDER_PROFILE);
  });

  it('has no profile id while the account\'s profiles load — only the display placeholder', () => {
    const current = resolveCurrentProfile(ACCOUNT, undefined, true);
    expect(current.status).toBe('loading');
    expect(current.profileId).toBeUndefined();
    expect(current.authUserId).toBe(ACCOUNT);
    expect(current.profile.id).toBe('');
  });

  it('acts as the only profile, by its own id — never the account id', () => {
    const current = resolveCurrentProfile(ACCOUNT, [profile('profile-1', 'individual')], false);
    expect(current.status).toBe('ready');
    expect(current.profileId).toBe('profile-1');
    expect(current.profileId).not.toBe(current.authUserId);
  });

  it('acts as the first profile it is given — the Individual, as fetchMyProfiles orders them', () => {
    const current = resolveCurrentProfile(
      ACCOUNT,
      [profile('individual-1', 'individual'), profile('business-1', 'business')],
      false,
    );
    expect(current.profileId).toBe('individual-1');
  });

  it('reports a signed-in account with no profile as missing, so the app routes to onboarding', () => {
    const current = resolveCurrentProfile(ACCOUNT, [], false);
    expect(current.status).toBe('missing');
    expect(current.profileId).toBeUndefined();
  });
});
