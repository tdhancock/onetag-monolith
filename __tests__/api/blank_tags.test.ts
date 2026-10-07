//
// target: __tests__/api/blank_tags.test.ts
//
// Blank Physical Tags (ONE-135, ONE-138), against the local stack, through
// the app's own data layer: a batch is made in one insert and listed as not
// linked, and a tag printed before it points anywhere resolves as unlinked —
// to its owner with the id to link it by, to anyone else with nothing — and
// records no Scan.

import { actAs } from './support/liveSupabase';
import { anonClient, sql } from './support/localStack';
import { createAccount, deleteAccounts, type Account } from './support/accounts';
import { createBlankTags, fetchMyTags, recordScan, resolveTag } from '../../features/tags/api';

let owner: Account;
let other: Account;
let shortCode: string;
let tagId: string;

beforeAll(async () => {
  [owner, other] = await Promise.all(['blankowner', 'blankother'].map(createAccount));
  [tagId, shortCode] = sql(`
    INSERT INTO public.tags (owner_profile_id, tag_type, format)
    VALUES ('${owner.profileId}', 'physical', 'qr') RETURNING id || ' ' || short_code;
  `).split(' ') as [string, string];
});

afterAll(() => deleteAccounts());

describe('a blank Physical Tag', () => {
  it('resolves, for its owner, as unlinked with the id to link it by', async () => {
    actAs(owner.client);
    expect(await resolveTag(shortCode)).toEqual({ status: 'unlinked', tagId, ownedByCaller: true });
  });

  it('resolves, for another account, as unlinked and nothing more', async () => {
    actAs(other.client);
    expect(await resolveTag(shortCode)).toEqual({ status: 'unlinked', tagId: null, ownedByCaller: false });
  });

  it('resolves, for a stranger with no account, the same way', async () => {
    actAs(anonClient());
    expect(await resolveTag(shortCode)).toEqual({ status: 'unlinked', tagId: null, ownedByCaller: false });
  });

  it('records no Scan, even given its id', async () => {
    actAs(anonClient());
    await expect(recordScan(tagId, null)).rejects.toBeTruthy();
    expect(sql(`SELECT count(*) FROM public.scans WHERE tag_id = '${tagId}';`)).toBe('0');
  });
});

describe('a batch of blank tags (ONE-138)', () => {
  it('makes twelve for the acting profile, each pointing nowhere, with its own code', async () => {
    actAs(owner.client);
    const made = await createBlankTags(owner.profileId, 12);
    expect(made).toHaveLength(12);
    expect(made.every((tag) => tag.tagType === 'physical' && tag.format === 'qr' && !tag.linked)).toBe(true);
    expect(new Set(made.map((tag) => tag.shortCode)).size).toBe(12);
    expect(
      sql(`
        SELECT count(*) FROM public.tags
        WHERE id IN (${made.map((tag) => `'${tag.id}'`).join(', ')})
          AND owner_profile_id = '${owner.profileId}'
          AND num_nonnulls(dest_profile_id, dest_product_id, dest_project_id, dest_post_id) = 0;
      `),
    ).toBe('12');
  });

  it("lists them on the owner's tags as not linked", async () => {
    actAs(owner.client);
    const mine = await fetchMyTags(owner.profileId);
    expect(mine.filter((tag) => !tag.linked).length).toBeGreaterThanOrEqual(12);
  });

  it("refuses a batch for someone else's profile", async () => {
    actAs(other.client);
    await expect(createBlankTags(owner.profileId, 12)).rejects.toBeTruthy();
  });
});
