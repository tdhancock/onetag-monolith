//
// target: __tests__/lib/projectVisibility.test.ts
//
// Public, Unlisted or Private (ONE-137), the pure logic: one visibility read
// from two columns and written back to them, what each says, the badge rows
// carry, and that an unlisted project is listed to its owner alone.

import {
  EMPTY_PROJECT_DRAFT,
  listedFor,
  PROJECT_VISIBILITIES,
  projectFieldsFrom,
  projectVisibilityDescription,
  visibilityBadge,
  visibilityOf,
} from '../../lib/screens/projects';

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
