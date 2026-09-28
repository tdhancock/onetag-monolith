// Throwaway accounts for the API checks (ONE-114), all on the local stack.
//
// `createAccount` makes one that can sign in, as the app would, and
// `signInAgain` gives it a second session, as a second device. `seedProfiles`
// makes many at once in SQL, for volume: they never sign in. Every one is
// tagged with this run, and `deleteAccounts` removes them all.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { admin, sql, stack } from './localStack';
import type { AuthUserId, ProfileId } from '../../../types';

export interface Account {
  userId: AuthUserId;
  profileId: ProfileId;
  username: string;
  email: string;
  client: SupabaseClient;
}

/** Tags this run's accounts, so its cleanup never reaches anyone else's. */
const RUN = Date.now().toString(36);
const DOMAIN = `${RUN}.api-check.test`;

/** A test-only password: the accounts exist only on the local stack. */
const passwordFor = (email: string) => `check-${email}`;

const newClient = () =>
  createClient(stack.url, stack.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

/** A signed-in account with a profile, as signing up in the app makes. */
export const createAccount = async (name: string): Promise<Account> => {
  const email = `${name}@${DOMAIN}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: passwordFor(email),
    email_confirm: true,
    user_metadata: { username: `${name}_${RUN}` },
  });
  if (error) throw error;

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, username')
    .eq('user_id', data.user.id)
    .single();
  if (profileError) throw profileError;

  const account = { userId: data.user.id as AuthUserId, profileId: profile.id as ProfileId, username: profile.username, email };
  return { ...account, client: await signInAgain(account) };
};

/** Another session for the account: the same person on another device. */
export const signInAgain = async (account: Pick<Account, 'email'>): Promise<SupabaseClient> => {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email: account.email, password: passwordFor(account.email) });
  if (error) throw error;
  return client;
};

/**
 * `count` profiles made in one statement, named `<prefix>1`, `<prefix>2`, …
 * followed by this run's tag. Returns their ids, in that order.
 */
export const seedProfiles = (prefix: string, count: number): ProfileId[] => {
  sql(`
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    SELECT gen_random_uuid(), '${prefix}' || g || '@${DOMAIN}',
           jsonb_build_object('username', '${prefix}' || g || '_${RUN}')
    FROM generate_series(1, ${count}) g;
  `);
  return sql(`
    SELECT p.id FROM public.profiles p JOIN auth.users u ON u.id = p.user_id
    WHERE u.email ~ '^${prefix}[0-9]+@' AND u.email LIKE '%@${DOMAIN}'
    ORDER BY substring(u.email FROM '^${prefix}([0-9]+)@')::int;
  `)
    .split('\n')
    .filter(Boolean) as ProfileId[];
};

/** Delete every account this run made; their rows go with them. */
export const deleteAccounts = (): void => {
  sql(`DELETE FROM auth.users WHERE email LIKE '%@${DOMAIN}';`);
};
