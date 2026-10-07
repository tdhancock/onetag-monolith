//
// target: __tests__/api/unlisted_projects.test.ts
//
// Unlisted projects (ONE-137), against the local stack, through the app's own
// data layer: a stranger can't read one until they open its tag; opening it
// records a grant that reads it, and what is inside it; search still never
// lists it; and pausing the tag ends the access.

import { actAs } from './support/liveSupabase';
import { anonClient } from './support/localStack';
import { createAccount, deleteAccounts, type Account } from './support/accounts';
import { createProject, fetchChildProjects, fetchProject } from '../../features/projects/api';
import { createTag, grantProjectTagAccess, resolveTag, setTagActive } from '../../features/tags/api';
import { searchProjects } from '../../features/search/api';
import type { ProjectFields } from '../../features/projects/types';

let owner: Account;
let plumber: Account;
let heater: string;
let house: string;
let furnace: string;
let shortCode: string;
let tagId: string;

const unlisted = (name: string, overrides: Partial<ProjectFields> = {}): ProjectFields => ({
  name,
  projectType: null,
  description: null,
  year: null,
  isPublic: false,
  unlisted: true,
  interestSlug: null,
  parentProjectId: null,
  ...overrides,
});

beforeAll(async () => {
  [owner, plumber] = await Promise.all(['unlistowner', 'unlistplumber'].map(createAccount));
  actAs(owner.client);
  house = await createProject(owner.userId, { ownerProfileId: owner.profileId, fields: unlisted('Zqx House'), coverUri: null });
  heater = await createProject(owner.userId, {
    ownerProfileId: owner.profileId,
    fields: unlisted('Zqx Water heater', { parentProjectId: house }),
    coverUri: null,
  });
  furnace = await createProject(owner.userId, {
    ownerProfileId: owner.profileId,
    fields: unlisted('Zqx Furnace', { parentProjectId: house, unlisted: false }),
    coverUri: null,
  });
  const tag = await createTag({
    ownerProfileId: owner.profileId,
    tagType: 'physical',
    destination: { kind: 'project', id: house },
    name: null,
    note: null,
  });
  shortCode = tag.shortCode;
  tagId = tag.id;
});

afterAll(() => deleteAccounts());

describe('an unlisted project', () => {
  it('is hidden from a stranger with no account, and from an account that never opened its tag', async () => {
    actAs(anonClient());
    expect(await fetchProject(house)).toBeNull();
    actAs(plumber.client);
    expect(await fetchProject(house)).toBeNull();
  });

  it('resolves as unlisted, so the app knows to grant on the way', async () => {
    actAs(plumber.client);
    expect(await resolveTag(shortCode)).toMatchObject({ status: 'active', projectUnlisted: true });
  });

  it("opens for an account that opened its tag, with the unlisted project inside it but not the private one", async () => {
    actAs(plumber.client);
    expect(await grantProjectTagAccess(shortCode, plumber.profileId)).toBe(true);
    expect((await fetchProject(house))?.name).toBe('Zqx House');
    expect((await fetchChildProjects(house)).map((p) => p.id)).toEqual([heater]);
    expect(furnace).toBeDefined();
  });

  it('is still listed nowhere: search leaves it out, even for the account holding its tag', async () => {
    actAs(plumber.client);
    expect((await searchProjects('Zqx')).map((p) => p.id)).toEqual([]);
  });

  it('refuses a grant for someone else\'s profile', async () => {
    actAs(plumber.client);
    expect(await grantProjectTagAccess(shortCode, owner.profileId)).toBe(false);
  });

  it('closes again when its owner pauses the tag', async () => {
    actAs(owner.client);
    await setTagActive(tagId, false);
    actAs(plumber.client);
    expect(await fetchProject(house)).toBeNull();
  });
});
