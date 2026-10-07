//
// target: __tests__/lib/projectVisibility.test.ts
//
// Public, Unlisted or Private (ONE-137), the pure logic: one visibility read
// from two columns and written back to them, what each says, the badge rows
// carry, that an unlisted project is listed to its owner alone, and that its
// owner shares it through a Digital Tag.

import {
  EMPTY_PROJECT_DRAFT,
  listedFor,
  PROJECT_VISIBILITIES,
  projectFieldsFrom,
  projectShareFor,
  projectVisibilityDescription,
  shareableTagFor,
  shareTagFor,
  visibilityBadge,
  visibilityOf,
} from '../../lib/screens/projects';
import type { OwnedTag } from '../../features/tags';
import type { ProfileId } from '../../types';

describe('a visibility', () => {
  it('is read from the two columns', () => {
    expect(visibilityOf({ isPublic: true, unlisted: false })).toBe('public');
    expect(visibilityOf({ isPublic: false, unlisted: true })).toBe('unlisted');
    expect(visibilityOf({ isPublic: false, unlisted: false })).toBe('private');
  });

  it('is written back to them, never public and unlisted at once', () => {
    for (const { value } of PROJECT_VISIBILITIES) {
      const fields = projectFieldsFrom({ ...EMPTY_PROJECT_DRAFT, name: 'House', visibility: value });
      expect(visibilityOf(fields)).toBe(value);
      expect(fields.isPublic && fields.unlisted).toBe(false);
    }
  });

  it('is offered as Public, Unlisted and Private, each saying who can see it', () => {
    expect(PROJECT_VISIBILITIES.map((v) => v.label)).toEqual(['Public', 'Unlisted', 'Private']);
    expect(projectVisibilityDescription('unlisted')).toMatch(/Anyone with its tag can see it/);
    expect(projectVisibilityDescription('unlisted')).toMatch(/isn't listed anywhere/);
    expect(projectVisibilityDescription('private')).toMatch(/Only you and its contributors/);
  });

  it('badges an unlisted or private project, and not a public one', () => {
    expect(visibilityBadge({ isPublic: true, unlisted: false })).toBeNull();
    expect(visibilityBadge({ isPublic: false, unlisted: true })).toBe('Unlisted');
    expect(visibilityBadge({ isPublic: false, unlisted: false })).toBe('Private');
  });
});

describe('listing projects', () => {
  const PROJECTS = [
    { id: 'pub', ownerProfileId: 'p-ana', unlisted: false },
    { id: 'unl', ownerProfileId: 'p-ana', unlisted: true },
  ];

  it('lists an unlisted project to its owner', () => {
    expect(listedFor(PROJECTS, 'p-ana').map((p) => p.id)).toEqual(['pub', 'unl']);
  });

  it('leaves it out for anyone else, even someone who holds its tag', () => {
    expect(listedFor(PROJECTS, 'p-plumber').map((p) => p.id)).toEqual(['pub']);
    expect(listedFor(PROJECTS, undefined).map((p) => p.id)).toEqual(['pub']);
  });
});

describe('sharing an unlisted project', () => {
  const tag = (overrides: Record<string, unknown>) =>
    ({
      id: 't',
      ownerProfileId: 'p-ana',
      tagType: 'digital',
      format: null,
      name: null,
      note: null,
      shortCode: 'DGTL2345',
      active: true,
      createdAt: '2026-10-01T00:00:00Z',
      destination: { kind: 'project', projectId: 'pj-house', name: 'House' },
      linked: true,
      scanCount: 0,
      lastScannedAt: null,
      ...overrides,
    }) as OwnedTag;

  it('shares a public or private project by its app link, and an unlisted one through a tag, for its owner alone', () => {
    expect(projectShareFor({ isPublic: true, unlisted: false }, false)).toBe('app-link');
    expect(projectShareFor({ isPublic: false, unlisted: false }, true)).toBe('app-link');
    expect(projectShareFor({ isPublic: false, unlisted: true }, true)).toBe('tag-link');
    expect(projectShareFor({ isPublic: false, unlisted: true }, false)).toBeNull();
  });

  it("reuses the owner's active Digital Tag for it, and never a Physical, paused or other one", () => {
    const physical = tag({ id: 'phys', tagType: 'physical' });
    const paused = tag({ id: 'paused', active: false });
    const elsewhere = tag({ id: 'else', destination: { kind: 'project', projectId: 'pj-shed', name: 'Shed' } });
    const shared = tag({ id: 'shared' });
    expect(shareableTagFor([physical, paused, elsewhere, shared], 'pj-house')?.id).toBe('shared');
    expect(shareableTagFor([physical, paused, elsewhere], 'pj-house')).toBeNull();
    expect(shareableTagFor(undefined, 'pj-house')).toBeNull();
  });

  it('makes a Digital Tag named Shared link when there is none', () => {
    expect(shareTagFor('p-ana' as ProfileId, 'pj-house')).toEqual({
      ownerProfileId: 'p-ana',
      tagType: 'digital',
      destination: { kind: 'project', id: 'pj-house' },
      name: 'Shared link',
      note: null,
    });
  });
});
