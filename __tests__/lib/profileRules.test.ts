//
// target: __tests__/lib/profileRules.test.ts
// The profile's rules (ONE-68, ONE-43) — lib/screens/profile: which tabs
// show for which profile and viewer, what an empty tab or list says, the
// grid's geometry, and when Edit profile has something to save.

import {
  firstLine,
  hasProfileChanges,
  profileEmptyState,
  profileGridTileSize,
  profileTabsFor,
  PROFILE_GRID_COLUMNS,
  PROFILE_GRID_GAP,
  PROFILE_TAB_LABELS,
  userListEmptyTitle,
  usernameError,
} from '../../lib/screens/profile';

describe('profileTabsFor (ONE-43)', () => {
  it('gives a business Products, Projects and Media, whoever is looking', () => {
    expect(profileTabsFor({ profileType: 'business', isOwnProfile: true })).toEqual(['products', 'projects', 'media']);
    expect(profileTabsFor({ profileType: 'business', isOwnProfile: false, scanHistoryPublic: true })).toEqual([
      'products',
      'projects',
      'media',
    ]);
  });

  it('gives your own individual profile Posts, Saves, Projects and Scans', () => {
    expect(profileTabsFor({ profileType: 'individual', isOwnProfile: true })).toEqual(['posts', 'saves', 'projects', 'scans']);
  });

  it('never gives a visitor Saves, and Scans only while the history is public', () => {
    expect(profileTabsFor({ profileType: 'individual', isOwnProfile: false, scanHistoryPublic: false })).toEqual([
      'posts',
      'projects',
    ]);
    expect(profileTabsFor({ profileType: 'individual', isOwnProfile: false, scanHistoryPublic: true })).toEqual([
      'posts',
      'projects',
      'scans',
    ]);
  });

  it('decides by type, never by content: an unknown type reads as individual', () => {
    expect(profileTabsFor({ isOwnProfile: false })).toEqual(['posts', 'projects']);
  });

  it('names every tab', () => {
    expect(PROFILE_TAB_LABELS).toEqual({
      posts: 'Posts',
      media: 'Media',
      products: 'Products',
      projects: 'Projects',
      saves: 'Saves',
      scans: 'Scans',
    });
  });
});

describe('profileEmptyState', () => {
  it('invites your first post on your own empty Posts tab', () => {
    expect(profileEmptyState('posts', true)).toEqual({
      title: 'No posts yet',
      body: 'Share a photo or a thought.',
      action: { label: 'Create your first post', target: '/compose' },
    });
  });

  it("prompts the action on your own profile, and offers none on someone else's", () => {
    const tabs = ['posts', 'media', 'products', 'projects', 'scans'] as const;
    for (const tab of tabs) {
      expect(profileEmptyState(tab, true).action).toBeDefined();
      expect(profileEmptyState(tab, false).action).toBeUndefined();
    }
    expect(profileEmptyState('products', true).action).toEqual({ label: 'Add your first product', target: '/product/create' });
    expect(profileEmptyState('products', false)).toEqual({
      title: 'No products yet',
      body: 'This business has not listed any products.',
    });
  });

  it('says what an empty contributed list means, with nothing to do about it', () => {
    expect(profileEmptyState('projects', true, { projectsView: 'contributed' }).action).toBeUndefined();
    expect(profileEmptyState('projects', true, { projectsView: 'owned' }).action).toEqual({
      label: 'Start a project',
      target: '/project/create',
    });
  });

  it('says "Nothing saved yet" for Saves, and something narrower for a filtered one', () => {
    expect(profileEmptyState('saves', true).title).toBe('Nothing saved yet');
    expect(profileEmptyState('saves', true, { savesFilter: 'product' }).title).toBe('Nothing saved here');
  });
});

describe('profileGridTileSize', () => {
  it('fits three square tiles and two 1pt gaps across the width', () => {
    expect(PROFILE_GRID_COLUMNS).toBe(3);
    expect(PROFILE_GRID_GAP).toBe(1);
    const size = profileGridTileSize(375);
    expect(size * 3 + 2).toBeCloseTo(375, 5);
  });
});

describe('firstLine', () => {
  it('takes the first line with anything on it', () => {
    expect(firstLine('hello\nworld')).toBe('hello');
    expect(firstLine('\n  \n second line')).toBe('second line');
    expect(firstLine('')).toBe('');
    expect(firstLine(null)).toBe('');
  });
});

describe('userListEmptyTitle', () => {
  it('names what the list is missing', () => {
    expect(userListEmptyTitle('followers')).toBe('No followers yet');
    expect(userListEmptyTitle('following')).toBe('Not following anyone yet');
    expect(userListEmptyTitle('likes')).toBe('No likes yet');
    expect(userListEmptyTitle('reposts')).toBe('No reposts yet');
    expect(userListEmptyTitle(undefined)).toBe('No one here yet');
  });
});

describe('hasProfileChanges', () => {
  const original = { name: 'Ana', username: 'ana', bio: 'hi' };

  it('has nothing to save until something changes', () => {
    expect(hasProfileChanges(original, { ...original }, false)).toBe(false);
  });

  it('has something once a field or the photo changes', () => {
    expect(hasProfileChanges(original, { ...original, bio: 'hello' }, false)).toBe(true);
    expect(hasProfileChanges(original, { ...original, username: 'ana2' }, false)).toBe(true);
    expect(hasProfileChanges(original, { ...original }, true)).toBe(true);
  });

  it('treats a missing field on the profile as empty', () => {
    expect(hasProfileChanges({ username: 'ana' }, { name: '', username: 'ana', bio: '' }, false)).toBe(false);
  });
});

describe('usernameError', () => {
  // The rule sign-up has always applied, now shared with Edit profile.
  it('accepts lowercase letters, numbers, "_" and "." within 3 to 20 characters', () => {
    expect(usernameError('ana_b.3')).toBeNull();
    expect(usernameError('abc')).toBeNull();
    expect(usernameError('a'.repeat(20))).toBeNull();
  });

  it('refuses spaces, capitals and other characters, which break profile links', () => {
    expect(usernameError('ana b')).toMatch(/lowercase letters/);
    expect(usernameError('Ana')).toMatch(/lowercase letters/);
    expect(usernameError('ana!')).toMatch(/lowercase letters/);
  });

  it('refuses a handle outside the length the database allows', () => {
    expect(usernameError('ab')).toMatch(/between 3 and 20/);
    expect(usernameError('a'.repeat(21))).toMatch(/between 3 and 20/);
  });

  it('has nothing to say about an empty field; the caller decides', () => {
    expect(usernameError('')).toBeNull();
  });
});
