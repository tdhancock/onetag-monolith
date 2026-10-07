//
// target: __tests__/api/nested_projects.test.ts
//
// Projects inside a project (ONE-134), against the local stack, through the
// app's own data layer: a house holds a furnace, the furnace names the house
// to whoever may see it, a third level and someone else's house are refused,
// and deleting the house takes the furnace with it.

import { actAs } from './support/liveSupabase';
import { sql } from './support/localStack';
import { createAccount, deleteAccounts, type Account } from './support/accounts';
import {
  createProject,
  deleteProject,
  fetchChildProjects,
  fetchOwnedProjects,
  fetchProject,
  updateProject,
} from '../../features/projects/api';
import type { ProjectFields } from '../../features/projects/types';

let owner: Account;
let other: Account;
let house: string;
let furnace: string;

const fields = (name: string, overrides: Partial<ProjectFields> = {}): ProjectFields => ({
  name,
  projectType: null,
  description: null,
  year: null,
  isPublic: true,
  interestSlug: null,
  parentProjectId: null,
  ...overrides,
});

beforeAll(async () => {
  [owner, other] = await Promise.all(['nestowner', 'nestother'].map(createAccount));
});

afterAll(() => deleteAccounts());

describe('projects inside a project', () => {
  it('creates a furnace inside the house, and lists it there', async () => {
    actAs(owner.client);
    house = await createProject(owner.userId, { ownerProfileId: owner.profileId, fields: fields('House'), coverUri: null });
    furnace = await createProject(owner.userId, {
      ownerProfileId: owner.profileId,
      fields: fields('Furnace', { parentProjectId: house }),
      coverUri: null,
    });
    expect((await fetchChildProjects(house)).map((p) => [p.id, p.parentProjectId])).toEqual([[furnace, house]]);
  });

  it('reads the furnace with the house it is part of', async () => {
    actAs(owner.client);
    expect((await fetchProject(furnace))?.parent).toEqual({ id: house, name: 'House' });
    expect((await fetchProject(house))?.parent).toBeNull();
  });

  it("still lists every project the account owns, children included, for the tag picker", async () => {
    actAs(owner.client);
    expect((await fetchOwnedProjects(owner.profileId)).map((p) => p.id).sort()).toEqual([furnace, house].sort());
  });

  it('refuses a third level', async () => {
    actAs(owner.client);
    await expect(
      createProject(owner.userId, {
        ownerProfileId: owner.profileId,
        fields: fields('Filter', { parentProjectId: furnace }),
        coverUri: null,
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it("refuses another account's project inside the house", async () => {
    actAs(other.client);
    const theirs = await createProject(other.userId, { ownerProfileId: other.profileId, fields: fields('Theirs'), coverUri: null });
    await expect(updateProject(theirs, { parentProjectId: house })).rejects.toMatchObject({ code: '23514' });
  });

  it("names no house a stranger may not see", async () => {
    actAs(owner.client);
    await updateProject(house, { isPublic: false });
    actAs(other.client);
    const seen = await fetchProject(furnace);
    expect(seen?.name).toBe('Furnace');
    expect(seen?.parent).toBeNull();
  });

  it('deletes the furnace with the house', async () => {
    actAs(owner.client);
    await deleteProject(house);
    expect(sql(`SELECT count(*) FROM public.projects WHERE id = '${furnace}';`)).toBe('0');
  });
});
