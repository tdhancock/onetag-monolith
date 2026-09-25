//
// target: __tests__/lib/profileRules.test.ts
// The re-skinned profile's rules (ONE-68) — lib/screens/profile: which tabs
// show, what an empty tab or list says, the grid's geometry, and when Edit
// profile has something to save.

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

describe('profileTabsFor', () => {
  it('shows Saved on your own profile only', () => {
    expect(profileTabsFor(true)).toEqual(['posts', 'reposts', 'saved']);
    expect(profileTabsFor(false)).toEqual(['posts', 'reposts']);
  });

  it('names every tab for screen readers', () => {
    expect(PROFILE_TAB_LABELS).toEqual({ posts: 'Posts', reposts: 'Reposts', saved: 'Saved' });
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

  it('offers no action on someone else\'s', () => {
    expect(profileEmptyState('posts', false).action).toBeUndefined();
    expect(profileEmptyState('reposts', false).title).toBe('No reposts yet');
  });

  it('says "Nothing saved yet" for Saved', () => {
    expect(profileEmptyState('saved', true).title).toBe('Nothing saved yet');
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
