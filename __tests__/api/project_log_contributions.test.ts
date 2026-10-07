//
// target: __tests__/api/project_log_contributions.test.ts
//
// Writing to someone else's project log (ONE-143), against the local stack,
// through the app's own data layer: a Linked Contributor's entry is published
// at once and the owner hears of it; a business whose account scanned the
// project's tag proposes one, which only it and the owner read, and the owner
// hears of that too; approving publishes it and Links the business; and a
// business that never scanned is refused.

import { actAs } from './support/liveSupabase';
import { anonClient } from './support/localStack';
import { createAccount, deleteAccounts, type Account } from './support/accounts';
import {
  addContributor,
  approveLogEntry,
  createLogEntry,
  createProject,
  fetchContributors,
  fetchProjectLog,
  logEntryStatusFor,
} from '../../features/projects/api';
import { createProfile } from '../../features/profiles/api';
import { createTag, recordScan } from '../../features/tags/api';
import { fetchNotifications } from '../../features/notifications/api';
import type { ProjectFields, ProjectLogEntryFields } from '../../features/projects/types';
import type { ProfileId } from '../../types';

let owner: Account;
let contributor: Account;
let scanner: Account;
let stranger: Account;
let contributorBiz: ProfileId;
let scannerBiz: ProfileId;
let strangerBiz: ProfileId;
let furnace: string;
let proposal: string;

const fields: ProjectFields = {
  name: 'Furnace',
  projectType: null,
  description: null,
  year: null,
  isPublic: true,
  unlisted: false,
  interestSlug: null,
  parentProjectId: null,
};

const entry = (title: string, performedByProfileId: string | null = null): ProjectLogEntryFields => ({
  occurredOn: '2026-04-01',
  title,
  notes: null,
  costCents: null,
  currency: 'USD',
  performedByProfileId,
});

/**
 * A business profile on an account: its second profile. Its handle is short,
 * since a handle is at most 20 characters, and carries the run's tag, as the
 * account's own does.
 */
const business = async (account: Account, handle: string): Promise<ProfileId> => {
  actAs(account.client);
  const profile = await createProfile({
    profileType: 'business',
    username: `${handle}_${account.username.split('_').pop()}`,
    fullName: `${handle} Services`,
  });
  return profile.id as ProfileId;
};

beforeAll(async () => {
  [owner, contributor, scanner, stranger] = await Promise.all(
    ['logpowner', 'logpcontrib', 'logpscan', 'logpstrange'].map(createAccount),
  );
  contributorBiz = await business(contributor, 'bcon');
  scannerBiz = await business(scanner, 'bscan');
  strangerBiz = await business(stranger, 'bstr');

  actAs(owner.client);
  furnace = await createProject(owner.userId, { ownerProfileId: owner.profileId, fields, coverUri: null });
  await addContributor({ projectId: furnace, profileId: contributorBiz, role: null });
  const tag = await createTag({
    ownerProfileId: owner.profileId,
    tagType: 'physical',
    destination: { kind: 'project', id: furnace },
    name: null,
    note: null,
  });

  // The technician scans the sticker on the furnace as themselves.
  actAs(scanner.client);
  await recordScan(tag.id, scanner.profileId);
});

afterAll(() => deleteAccounts());

describe("writing to someone else's project log", () => {
  it("publishes a Contributor's entry at once, and tells the owner", async () => {
    actAs(contributor.client);
    expect(await logEntryStatusFor(furnace, contributorBiz)).toBe('published');
    await createLogEntry(contributor.userId, {
      projectId: furnace,
      authorProfileId: contributorBiz,
      status: 'published',
      fields: entry('Annual service', contributorBiz),
      photoUris: [],
    });

    actAs(anonClient());
    expect((await fetchProjectLog(furnace)).map((e) => [e.title, e.status])).toEqual([['Annual service', 'published']]);

    actAs(owner.client);
    const notice = (await fetchNotifications(owner.profileId)).find((n) => n.type === 'log_entry_added');
    expect(notice).toMatchObject({ sender: { id: contributorBiz }, project: { id: furnace, name: 'Furnace' } });
  });

  it('lets a business whose account scanned the tag propose an entry, which only it and the owner read', async () => {
    actAs(scanner.client);
    expect(await logEntryStatusFor(furnace, scannerBiz)).toBe('proposed');
    proposal = await createLogEntry(scanner.userId, {
      projectId: furnace,
      authorProfileId: scannerBiz,
      status: 'proposed',
      fields: entry('Replaced the igniter', scannerBiz),
      photoUris: [],
    });
    expect((await fetchProjectLog(furnace)).find((e) => e.id === proposal)).toMatchObject({
      status: 'proposed',
      authorProfileId: scannerBiz,
    });

    actAs(stranger.client);
    expect((await fetchProjectLog(furnace)).map((e) => e.id)).not.toContain(proposal);

    actAs(owner.client);
    expect((await fetchProjectLog(furnace)).find((e) => e.id === proposal)?.author?.id).toBe(scannerBiz);
    const notice = (await fetchNotifications(owner.profileId)).find((n) => n.type === 'log_entry_proposed');
    expect(notice).toMatchObject({ sender: { id: scannerBiz }, project: { id: furnace } });
  });

  it("won't let the proposing business publish it itself", async () => {
    actAs(scanner.client);
    await expect(approveLogEntry(proposal)).rejects.toMatchObject({ code: '42501' });
  });

  it('publishes the proposal when the owner approves it, and Links the business as a Contributor', async () => {
    actAs(owner.client);
    expect(await approveLogEntry(proposal)).toBe(true);
    actAs(anonClient());
    expect((await fetchProjectLog(furnace)).find((e) => e.id === proposal)?.status).toBe('published');
    expect((await fetchContributors(furnace)).map((c) => c.profileId)).toContain(scannerBiz);
  });

  it('refuses a business that never scanned the tag', async () => {
    actAs(stranger.client);
    expect(await logEntryStatusFor(furnace, strangerBiz)).toBeNull();
    await expect(
      createLogEntry(stranger.userId, {
        projectId: furnace,
        authorProfileId: strangerBiz,
        status: 'proposed',
        fields: entry('Cold call'),
        photoUris: [],
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
