//
// target: __tests__/api/select_strings.test.ts
//
// Every select string the app exports, run against the local API as a
// signed-in account. PostgREST parses a select before it reads a row, so a
// renamed column, an ambiguous embed or a missing relationship fails here
// with no data needed. A bare `profiles` embed in the message select failed
// every thread read this way, unnoticed by every mocked suite (ONE-110).
// A new exported select string belongs in this list.

import { actAs, supabase } from './support/liveSupabase';
import { createAccount, deleteAccounts, type Account } from './support/accounts';
import { POST_SELECT_QUERY, scopePostsToViewer } from '../../services/postRows';
import { PRODUCT_SUMMARY_SELECT } from '../../services/productRows';
import { PROJECT_SUMMARY_SELECT } from '../../services/projectRows';
import { MESSAGE_SELECT_QUERY } from '../../features/messages/api';
import { NOTIFICATION_SELECT_QUERY } from '../../features/notifications/api';
import { PRODUCT_SELECT } from '../../features/products/api';
import { CONTRIBUTOR_SELECT, PROJECT_SELECT } from '../../features/projects/api';
import { TAG_SELECT } from '../../features/tags/api';
import { PROFILE_SELECT } from '../../features/profiles/api';
import { SAVE_SELECT } from '../../features/saves/api';

let reader: Account;

beforeAll(async () => {
  reader = await createAccount('selreader');
  actAs(reader.client);
});

afterAll(() => deleteAccounts());

const SELECTS: [name: string, table: string, select: string][] = [
  ['MESSAGE_SELECT_QUERY', 'messages', MESSAGE_SELECT_QUERY],
  ['NOTIFICATION_SELECT_QUERY', 'notifications', NOTIFICATION_SELECT_QUERY],
  ['PRODUCT_SELECT', 'products', PRODUCT_SELECT],
  ['PRODUCT_SUMMARY_SELECT', 'products', PRODUCT_SUMMARY_SELECT],
  ['PROJECT_SELECT', 'projects', PROJECT_SELECT],
  ['PROJECT_SUMMARY_SELECT', 'projects', PROJECT_SUMMARY_SELECT],
  ['CONTRIBUTOR_SELECT', 'contributors', CONTRIBUTOR_SELECT],
  ['TAG_SELECT', 'tags', TAG_SELECT],
  ['PROFILE_SELECT', 'profiles', PROFILE_SELECT],
  ['SAVE_SELECT', 'saves', SAVE_SELECT],
];

describe("the app's select strings", () => {
  it.each(SELECTS)('%s reads from %s', async (_name, table, select) => {
    const { error } = await supabase.from(table).select(select).limit(1);
    expect(error).toBeNull();
  });

  it('POST_SELECT_QUERY reads posts, scoped to the viewer as every post list is', async () => {
    const { error } = await scopePostsToViewer(supabase.from('posts').select(POST_SELECT_QUERY), reader.profileId).limit(1);
    expect(error).toBeNull();
  });

  it('MESSAGE_SELECT_QUERY reads a thread through messages_thread too', async () => {
    const { error } = await supabase
      .rpc('messages_thread', { p_profile: reader.profileId, p_other: reader.profileId })
      .select(MESSAGE_SELECT_QUERY)
      .order('created_at', { ascending: false });
    expect(error).toBeNull();
  });
});
