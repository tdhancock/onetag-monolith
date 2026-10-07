//
// target: __tests__/api/blank_tags.test.ts
//
// Blank Physical Tags (ONE-135), against the local stack, through the app's
// own data layer: a tag printed before it points anywhere resolves as
// unlinked — to its owner with the id to link it by, to anyone else with
// nothing — and records no Scan.

import { actAs } from './support/liveSupabase';
import { anonClient, sql } from './support/localStack';
import { createAccount, deleteAccounts, type Account } from './support/accounts';
import { recordScan, resolveTag } from '../../features/tags/api';

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
