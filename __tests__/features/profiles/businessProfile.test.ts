//
// target: __tests__/features/profiles/businessProfile.test.ts
//
// Business Profile fields (ONE-23), in the data layer and the rules the
// screens share:
//
//   1. A profile and its business fields arrive in one request — the select
//      embeds `business_profiles` — and map onto `UserProfile.business` only
//      for a business profile.
//   2. Saving business fields upserts one row keyed on the profile id.
//   3. What a header shows is decided by `profileType`; the website is stored
//      with its scheme and shown without it.

const mockFrom = jest.fn();
jest.mock('../../../services/supabase.native', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args), auth: { getUser: jest.fn() } },
}), { virtual: true });

import {
  PROFILE_SELECT,
  fetchMyProfiles,
  getUserProfile,
  mapProfileRow,
  mapBusinessUpdatesToRow,
  updateBusinessProfile,
} from '../../../features/profiles/api';
import type { ProfileRow } from '../../../features/profiles/types';
import {
  businessDetailsFor,
  businessUpdatesFrom,
  hasBusinessChanges,
  normalizeWebsite,
  websiteError,
  websiteLabel,
  WEBSITE_ERROR,
} from '../../../lib/screens/profile';
import { asAuthUserId, asProfileId } from '../../../types';

const row = (overrides: Partial<ProfileRow> = {}): ProfileRow => ({
  id: 'p-1',
  full_name: 'Ana Reyes',
  username: 'ana',
  bio: null,
  avatar_url: null,
  is_verified: false,
  is_private: false,
  user_id: 'auth-1',
  profile_type: 'individual',
  ...overrides,
});

const BUSINESS_ROW = { category: 'Cafe', website: 'https://ana.example', location: 'Lisbon', logo_url: null };

beforeEach(() => mockFrom.mockReset());

// ─── 1. Reading ─────────────────────────────────────────────────────────

describe('reading a profile with its business fields', () => {
  it('asks for the business row inside the profile select, so it is one request', () => {
    expect(PROFILE_SELECT).toBe('*, business_profiles(category, website, location, logo_url)');
  });

  it('fetches someone by username in a single query that embeds their business fields', async () => {
    const select = jest.fn(() => ({
      eq: () => ({ single: () => Promise.resolve({ data: row({ profile_type: 'business', business_profiles: BUSINESS_ROW }), error: null }) }),
    }));
    mockFrom.mockReturnValue({ select });

    const profile = await getUserProfile('ana');

    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(select).toHaveBeenCalledWith(PROFILE_SELECT);
    expect(profile!.business).toEqual({ category: 'Cafe', website: 'https://ana.example', location: 'Lisbon', logoUrl: null });
  });

  it("reads the account's own profiles with the same select", async () => {
    const select = jest.fn(() => ({ eq: () => Promise.resolve({ data: [row()], error: null }) }));
    mockFrom.mockReturnValue({ select });

    await fetchMyProfiles(asAuthUserId('auth-1'));
    expect(select).toHaveBeenCalledWith(PROFILE_SELECT);
  });

  it('maps the business row onto a business profile, as an object or a one-element array', () => {
    const expected = { category: 'Cafe', website: 'https://ana.example', location: 'Lisbon', logoUrl: null };
    expect(mapProfileRow(row({ profile_type: 'business', business_profiles: BUSINESS_ROW })).business).toEqual(expected);
    expect(mapProfileRow(row({ profile_type: 'business', business_profiles: [BUSINESS_ROW] })).business).toEqual(expected);
  });

  it('gives a business profile with no row yet null business fields', () => {
    expect(mapProfileRow(row({ profile_type: 'business', business_profiles: null })).business).toBeNull();
    expect(mapProfileRow(row({ profile_type: 'business', business_profiles: [] })).business).toBeNull();
  });

  it('leaves an individual profile without business fields, exactly as before', () => {
    const profile = mapProfileRow(row({ business_profiles: null }));
    expect(profile).not.toHaveProperty('business');
  });
});

// ─── 2. Writing ─────────────────────────────────────────────────────────

describe('saving business fields', () => {
  it('upserts one row keyed on the profile id, in column names', async () => {
    const upsert = jest.fn(() => Promise.resolve({ error: null }));
    mockFrom.mockReturnValue({ upsert });

    await updateBusinessProfile(asProfileId('p-biz'), { category: 'Bakery', website: 'https://b.example', logoUrl: 'https://cdn/x.png' });

    expect(mockFrom).toHaveBeenCalledWith('business_profiles');
    expect(upsert).toHaveBeenCalledWith(
      { profile_id: 'p-biz', category: 'Bakery', website: 'https://b.example', logo_url: 'https://cdn/x.png' },
      { onConflict: 'profile_id' },
    );
  });

  it('throws what the database refused — the type guard, or RLS', async () => {
    const refusal = { code: '42501', message: 'new row violates row-level security policy' };
    mockFrom.mockReturnValue({ upsert: () => Promise.resolve({ error: refusal }) });
    await expect(updateBusinessProfile(asProfileId('p-other'), { category: 'x' })).rejects.toBe(refusal);
  });

  it('sends only the fields that were given', () => {
    expect(mapBusinessUpdatesToRow({ location: 'Lisbon' })).toEqual({ location: 'Lisbon' });
    expect(mapBusinessUpdatesToRow({ website: null })).toEqual({ website: null });
  });
});

// ─── 3. What a profile shows, and the website rules ─────────────────────

describe('businessDetailsFor', () => {
  const business = { category: ' Cafe ', website: 'https://ana.example/', location: '', logoUrl: null };

  it('is null for an individual profile, whatever it carries', () => {
    expect(businessDetailsFor({ profileType: 'individual', business })).toBeNull();
    expect(businessDetailsFor({})).toBeNull();
    expect(businessDetailsFor(null)).toBeNull();
  });

  it('gives a business profile its details, blanks as null', () => {
    expect(businessDetailsFor({ profileType: 'business', business })).toEqual({
      category: 'Cafe',
      location: null,
      website: { url: 'https://ana.example/', label: 'ana.example' },
    });
  });

  it('still counts as a business profile before any field is filled', () => {
    expect(businessDetailsFor({ profileType: 'business', business: null })).toEqual({
      category: null,
      location: null,
      website: null,
    });
  });
});

describe('websites', () => {
  it.each([
    ['example.com', 'https://example.com'],
    ['  shop.example/menu ', 'https://shop.example/menu'],
    ['http://old.example', 'http://old.example'],
    ['HTTPS://Loud.example', 'https://Loud.example'],
    ['example.com:8080/x', 'https://example.com:8080/x'],
    ['', null],
    ['   ', null],
  ])('stores %j as %j', (input, stored) => {
    expect(normalizeWebsite(input)).toBe(stored);
  });

  it.each(['example.com', 'https://a.b.example/path?q=1', 'sub.domain.co.uk', ''])('accepts %j', (input) => {
    expect(websiteError(input)).toBeNull();
  });

  it.each(['not a website', 'localhost', 'javascript:alert(1)', 'mailto:ana@example.com', 'ftp://files.example', 'https://'])(
    'refuses %j',
    (input) => {
      expect(websiteError(input)).toBe(WEBSITE_ERROR);
    },
  );

  it('shows a website without its scheme or trailing slash', () => {
    expect(websiteLabel('https://ana.example/')).toBe('ana.example');
    expect(websiteLabel('http://ana.example/menu')).toBe('ana.example/menu');
  });
});

describe('the edit form', () => {
  const profile = { profileType: 'business' as const, business: { category: 'Cafe', website: 'https://a.example', location: null } };

  it('saves trimmed values, empties as null, the website normalized', () => {
    expect(businessUpdatesFrom({ category: ' Cafe ', website: 'b.example', location: '' })).toEqual({
      category: 'Cafe',
      website: 'https://b.example',
      location: null,
    });
  });

  it('counts a change only when something would save differently', () => {
    expect(hasBusinessChanges(profile, { category: 'Cafe', website: 'https://a.example', location: '' })).toBe(false);
    expect(hasBusinessChanges(profile, { category: 'Cafe ', website: 'a.example', location: ' ' })).toBe(false);
    expect(hasBusinessChanges(profile, { category: 'Bakery', website: 'https://a.example', location: '' })).toBe(true);
    expect(hasBusinessChanges(profile, { category: 'Cafe', website: '', location: '' })).toBe(true);
  });
});
