//
// target: __tests__/api/project_log.test.ts
//
// A project's log (ONE-141), against the local stack, through the app's own
// data layer: the owner logs entries, read newest first with who did it and
// their photos; the profile named takes its name off and the entry stays; an
// account that doesn't own the project is refused; a private project's log
// reaches its Contributor and nobody else; and swapping a photo on an entry
// that already has four goes through.

import { actAs } from './support/liveSupabase';
import { anonClient } from './support/localStack';
import { createAccount, deleteAccounts, type Account } from './support/accounts';
import {
  addContributor,
  createLogEntry,
  createProject,
  fetchProjectLog,
  removeMeFromLogEntry,
  saveLogEntryEdits,
} from '../../features/projects/api';
import type { ProjectFields, ProjectLogEntryFields } from '../../features/projects/types';

let owner: Account;
let named: Account;
let contributor: Account;
let stranger: Account;
let kitchen: string;
let safe: string;

const fields = (name: string, isPublic: boolean): ProjectFields => ({
  name,
  projectType: null,
  description: null,
  year: null,
  isPublic,
  unlisted: false,
  interestSlug: null,
  parentProjectId: null,
});

const entry = (overrides: Partial<ProjectLogEntryFields> = {}): ProjectLogEntryFields => ({
  occurredOn: '2026-03-12',
  title: 'Replaced the igniter',
  notes: null,
  costCents: null,
  currency: 'USD',
  performedByProfileId: null,
  ...overrides,
});

const photo = (n: number) => `https://example.test/log/${n}.jpg`;

/** Written as the owner, whose entries are published (ONE-143). */
const asOwner = () => ({ authorProfileId: owner.profileId, status: 'published' as const });

beforeAll(async () => {
  [owner, named, contributor, stranger] = await Promise.all(
    ['logowner', 'lognamed', 'logcontrib', 'logstranger'].map(createAccount),
  );
  actAs(owner.client);
  kitchen = await createProject(owner.userId, { ownerProfileId: owner.profileId, fields: fields('Kitchen', true), coverUri: null });
  safe = await createProject(owner.userId, { ownerProfileId: owner.profileId, fields: fields('Safe', false), coverUri: null });
  await addContributor({ projectId: safe, profileId: contributor.profileId, role: null });
});

afterAll(() => deleteAccounts());

describe('a project log', () => {
  let igniter: string;

  it('is read newest first, with who did it, what it cost and its photos in order', async () => {
    actAs(owner.client);
    await createLogEntry(owner.userId, { ...asOwner(), projectId: kitchen, fields: entry({ occurredOn: '2026-01-05', title: 'Changed the filter' }), photoUris: [] });
    igniter = await createLogEntry(owner.userId, {
      ...asOwner(),
      projectId: kitchen,
      fields: entry({ costCents: 18000, performedByProfileId: named.profileId, notes: 'Under warranty' }),
      photoUris: [photo(1), photo(2)],
    });

    actAs(anonClient());
    const log = await fetchProjectLog(kitchen);
    expect(log.map((e) => e.title)).toEqual(['Replaced the igniter', 'Changed the filter']);
    expect(log[0]).toMatchObject({
      costCents: 18000,
      currency: 'USD',
      performedByProfileId: named.profileId,
      performedBy: { id: named.profileId, username: named.username },
      photos: [expect.objectContaining({ url: photo(1) }), expect.objectContaining({ url: photo(2) })],
    });
  });

  it('lets the profile named take its name off, and the entry stays', async () => {
    actAs(named.client);
    expect(await removeMeFromLogEntry(igniter)).toBe(true);
    const after = (await fetchProjectLog(kitchen)).find((e) => e.id === igniter);
    expect(after).toMatchObject({ title: 'Replaced the igniter', performedByProfileId: null, performedBy: null });
  });

  it("refuses an entry from an account that doesn't own the project", async () => {
    actAs(stranger.client);
    await expect(
      createLogEntry(stranger.userId, {
        authorProfileId: stranger.profileId,
        status: 'published',
        projectId: kitchen,
        fields: entry({ title: 'Sneaky' }),
        photoUris: [],
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it("reads a private project's log to its Contributor, and to no one else", async () => {
    actAs(owner.client);
    await createLogEntry(owner.userId, { ...asOwner(), projectId: safe, fields: entry({ title: 'New combination' }), photoUris: [] });
    actAs(stranger.client);
    expect(await fetchProjectLog(safe)).toEqual([]);
    actAs(contributor.client);
    expect((await fetchProjectLog(safe)).map((e) => e.title)).toEqual(['New combination']);
  });

  it('swaps a photo on an entry that already has four', async () => {
    actAs(owner.client);
    const id = await createLogEntry(owner.userId, {
      ...asOwner(),
      projectId: kitchen,
      fields: entry({ title: 'Four photos' }),
      photoUris: [photo(1), photo(2), photo(3), photo(4)],
    });
    const stored = (await fetchProjectLog(kitchen)).find((e) => e.id === id)!;
    expect(stored.photos).toHaveLength(4);

    await saveLogEntryEdits(owner.userId, stored, {
      fields: entry({ title: 'Four photos' }),
      photoUris: [photo(4), photo(2), photo(3), photo(5)],
    });
    const saved = (await fetchProjectLog(kitchen)).find((e) => e.id === id)!;
    expect(saved.photos.map((p) => p.url)).toEqual([photo(4), photo(2), photo(3), photo(5)]);
  });
});
