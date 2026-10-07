//
// target: __tests__/api/project_details.test.ts
//
// Project details (ONE-140), against the local stack, through the app's own
// data layer: a template with one value filled stores one row; an edit that
// reorders and removes leaves the rows in its order; the database refuses a
// date that does not exist; and a detail is as visible as its project —
// hidden on a private one, readable on an unlisted one through its tag.

import { actAs } from './support/liveSupabase';
import { createAccount, deleteAccounts, type Account } from './support/accounts';
import { createProject, fetchProject, saveProjectEdits } from '../../features/projects/api';
import { createTag, grantProjectTagAccess } from '../../features/tags/api';
import type { ProjectFields } from '../../features/projects/types';
import { detailDraftsFromTemplate, detailInputsFrom, PROJECT_DETAIL_TEMPLATES } from '../../lib/screens/projectDetails';

let owner: Account;
let other: Account;

const fields = (name: string, overrides: Partial<ProjectFields> = {}): ProjectFields => ({
  name,
  projectType: null,
  description: null,
  year: null,
  isPublic: true,
  unlisted: false,
  interestSlug: null,
  parentProjectId: null,
  ...overrides,
});

const HVAC = PROJECT_DETAIL_TEMPLATES.find((t) => t.name === 'HVAC')!;

beforeAll(async () => {
  [owner, other] = await Promise.all(['detailsowner', 'detailsother'].map(createAccount));
});

afterAll(() => deleteAccounts());

describe('project details', () => {
  it('stores one row for the HVAC template with only Model number filled', async () => {
    actAs(owner.client);
    const drafts = detailDraftsFromTemplate(HVAC);
    drafts.find((d) => d.label === 'Model number')!.value = 'XR-200';
    const id = await createProject(owner.userId, {
      ownerProfileId: owner.profileId,
      fields: fields('Furnace'),
      coverUri: null,
      details: detailInputsFrom(drafts),
    });

    const { data } = await owner.client.from('project_details').select('label, kind, value').eq('project_id', id);
    expect(data).toEqual([{ label: 'Model number', kind: 'text', value: 'XR-200' }]);
    expect((await fetchProject(id))?.details).toEqual([
      expect.objectContaining({ label: 'Model number', kind: 'text', value: 'XR-200', sortOrder: 0 }),
    ]);
  });

  it('follows a new order, and forgets a removed detail, when saved again', async () => {
    actAs(owner.client);
    const id = await createProject(owner.userId, {
      ownerProfileId: owner.profileId,
      fields: fields('Water heater'),
      coverUri: null,
      details: [
        { label: 'Make', kind: 'text', value: 'Acme' },
        { label: 'Installed', kind: 'date', value: '2024-05-01' },
        { label: 'Manual', kind: 'link', value: 'https://acme.test/manual' },
      ],
    });
    const project = (await fetchProject(id))!;
    const [make, installed, manual] = project.details;

    await saveProjectEdits(owner.userId, project, {
      fields: fields('Water heater'),
      coverUri: null,
      details: [
        { id: manual!.id, label: 'Manual', kind: 'link', value: manual!.value },
        { id: installed!.id, label: 'Installed', kind: 'date', value: '2024-05-02' },
        { label: 'Capacity (gal)', kind: 'number', value: '40' },
      ],
    });

    const saved = (await fetchProject(id))!.details;
    expect(saved.map((d) => [d.label, d.value, d.sortOrder])).toEqual([
      ['Manual', 'https://acme.test/manual', 0],
      ['Installed', '2024-05-02', 1],
      ['Capacity (gal)', '40', 2],
    ]);
    expect(saved.map((d) => d.id)).not.toContain(make!.id);
  });

  it('is refused by the database when a date does not exist', async () => {
    actAs(owner.client);
    const id = await createProject(owner.userId, { ownerProfileId: owner.profileId, fields: fields('Shed'), coverUri: null });
    const { error } = await owner.client
      .from('project_details')
      .insert({ project_id: id, label: 'Installed', kind: 'date', value: '2026-02-30' });
    expect(error?.code).toBe('23514');
  });

  it('is hidden with a private project from another account', async () => {
    actAs(owner.client);
    const id = await createProject(owner.userId, {
      ownerProfileId: owner.profileId,
      fields: fields('Safe', { isPublic: false }),
      coverUri: null,
      details: [{ label: 'Combination', kind: 'text', value: 'Kept elsewhere' }],
    });
    actAs(other.client);
    const { data } = await other.client.from('project_details').select('id').eq('project_id', id);
    expect(data).toEqual([]);
  });

  it('is readable on an unlisted project once its tag is opened (ONE-137)', async () => {
    actAs(owner.client);
    const id = await createProject(owner.userId, {
      ownerProfileId: owner.profileId,
      fields: fields('Boiler', { isPublic: false, unlisted: true }),
      coverUri: null,
      details: [{ label: 'Filter size', kind: 'text', value: '16x25x1' }],
    });
    const tag = await createTag({
      ownerProfileId: owner.profileId,
      tagType: 'physical',
      destination: { kind: 'project', id },
      name: null,
      note: null,
    });

    actAs(other.client);
    const before = await other.client.from('project_details').select('id').eq('project_id', id);
    expect(before.data).toEqual([]);
    expect(await grantProjectTagAccess(tag.shortCode, other.profileId)).toBe(true);
    expect((await fetchProject(id))?.details.map((d) => d.value)).toEqual(['16x25x1']);
  });
});
