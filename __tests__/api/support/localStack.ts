// The local Supabase stack the API checks run against (ONE-114).
//
// Keys come from SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
// when they are set, and otherwise from `supabase status`. Only a local stack
// is accepted: these checks create and delete accounts with the service key,
// and seed the database directly, which no hosted project should see.

import { execFileSync, execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const REPO = join(__dirname, '..', '..', '..');
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

/** `KEY="value"` lines from `supabase status -o env`. */
const statusEnv = (): Record<string, string> => {
  const out = execSync('npx supabase status -o env', {
    cwd: REPO,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const env: Record<string, string> = {};
  for (const line of out.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
};

const resolveStack = () => {
  let url = process.env.SUPABASE_URL;
  let anonKey = process.env.SUPABASE_ANON_KEY;
  let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    const status = statusEnv();
    url ??= status.API_URL;
    anonKey ??= status.ANON_KEY;
    serviceKey ??= status.SERVICE_ROLE_KEY;
  }
  if (!url || !anonKey || !serviceKey) {
    throw new Error('No local Supabase stack found. Start one with `npm run db:start`.');
  }
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(`Refusing to run the API checks against ${host}: they run against a local stack only.`);
  }
  return { url, anonKey, serviceKey };
};

export const stack = resolveStack();

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

/** A client with no session: what someone signed out, or on the web, reaches. */
export const anonClient = (): SupabaseClient => createClient(stack.url, stack.anonKey, clientOptions);

/** The service role, for setting up and tearing down. It passes every RLS policy. */
export const admin: SupabaseClient = createClient(stack.url, stack.serviceKey, clientOptions);

const projectId = (): string => {
  const config = readFileSync(join(REPO, 'supabase', 'config.toml'), 'utf8');
  const match = config.match(/^project_id\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error('No project_id in supabase/config.toml.');
  return match[1];
};

/**
 * Run SQL as the database owner, for seeding at a volume the API would take
 * minutes over. Through the stack's own database container, so it reaches
 * nothing but the local database.
 */
export const sql = (query: string): string =>
  execFileSync(
    'docker',
    ['exec', '-i', `supabase_db_${projectId()}`, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'],
    { input: query, encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
  ).trim();
