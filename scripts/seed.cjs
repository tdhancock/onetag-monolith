#!/usr/bin/env node
// Loads the development seed, supabase/seeds/dev.sql, into the local stack or
// the hosted dev project. docs/seed-data.md says what's in it.
//
//   npm run db:seed                       the local stack (npm run db:start)
//   npm run db:seed:hosted                the hosted dev project
//   npm run db:seed:hosted -- --follow <username>
//                                         and that account follows every seed
//                                         profile, so its home feed fills
//
// The seed is made-up people and posts, and production will be a separate,
// empty project. So the hosted run names the dev project's ref on every call
// rather than trusting whatever the CLI is linked to: linking the CLI to
// production one day can't send the seed there.
//
// Node rather than sh, so `npm run` works from PowerShell too.

/* global __dirname -- a CommonJS script, which the app's lint config doesn't expect */

const { spawnSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

/** The hosted dev project, and the only hosted project the seed may reach. */
const DEV_PROJECT_REF = 'pyxqcqfpbaaszwmmkryc';

const ROOT = path.join(__dirname, '..');
const SEED_FILE = 'supabase/seeds/dev.sql';
/** Scratch SQL goes where the CLI keeps its own state, which git ignores. */
const SCRATCH_DIR = 'supabase/.temp';

/** Every seed account's id starts with this; everything else hangs off them. */
const SEED_ACCOUNT_PREFIX = '5eed0a00-';

/** The handle shape public.handle_new_user produces. */
const USERNAME = /^[a-z0-9_.]{3,20}$/i;

const SUMMARY = `select
  (select count(*) from public.profiles where user_id::text like '${SEED_ACCOUNT_PREFIX}%') as profiles,
  (select count(*) from public.posts where id::text like '5eed0c00-%') as posts,
  (select count(*) from public.products where id::text like '5eed0d00-%') as products,
  (select count(*) from public.projects where id::text like '5eed0e00-%') as projects,
  (select count(*) from public.tags where id::text like '5eed0700-%') as tags,
  (select count(*) from public.comments where id::text like '5eed0f00-%') as comments,
  (select count(*) from public.likes where post_id::text like '5eed0c00-%') as likes`;

/** One statement: the account follows every seed profile it doesn't already. */
const followSql = (username) => `with me as (
  select id from public.profiles where lower(username) = lower('${username}')
), followed as (
  insert into public.follows (follower_id, followed_id)
  select me.id, p.id from me, public.profiles p
  where p.user_id::text like '${SEED_ACCOUNT_PREFIX}%' and p.id <> me.id
  on conflict do nothing
  returning 1
)
select (select count(*) from me) as account_found, (select count(*) from followed) as newly_followed`;

/** The CLI flags that pick the database: never the linked project, always a named one. */
const targetFlags = (target) => (target === 'hosted' ? `--linked --project-ref ${DEV_PROJECT_REF}` : '--local');

/** The command that runs one SQL file against a target. */
const queryCommand = (target, file) => `npx supabase db query ${targetFlags(target)} -f ${file}`;

const parseArgs = (argv) => {
  const args = { target: null, follow: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--local' || arg === '--hosted') {
      if (args.target) throw new Error('Choose one of --local and --hosted.');
      args.target = arg.slice(2);
    } else if (arg === '--follow') {
      args.follow = argv[(i += 1)] ?? '';
      if (!USERNAME.test(args.follow)) throw new Error(`--follow takes a username, not "${args.follow}".`);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.target) throw new Error('Choose --local or --hosted.');
  return args;
};

const run = (command) => {
  console.log(`\n$ ${command}`);
  // One string, not an argument list: every part of it is ours, and Windows
  // needs a shell to find npx.
  const result = spawnSync(command, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const runSql = (target, name, sql) => {
  mkdirSync(path.join(ROOT, SCRATCH_DIR), { recursive: true });
  const file = `${SCRATCH_DIR}/${name}.sql`;
  writeFileSync(path.join(ROOT, file), sql);
  run(queryCommand(target, file));
};

const main = () => {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n\nUsage: node scripts/seed.cjs --local|--hosted [--follow <username>]`);
    process.exit(2);
  }

  console.log(args.target === 'hosted' ? `Seeding the hosted dev project, ${DEV_PROJECT_REF}.` : 'Seeding the local stack.');
  run(queryCommand(args.target, SEED_FILE));
  if (args.follow) runSql(args.target, 'seed-follow', followSql(args.follow));
  runSql(args.target, 'seed-summary', SUMMARY);
};

if (require.main === module) main();

module.exports = { DEV_PROJECT_REF, parseArgs, queryCommand, followSql };
