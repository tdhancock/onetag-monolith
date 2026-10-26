//
// target: __tests__/scripts/seed.test.ts
//
// The development seed's runner (scripts/seed.cjs). The seed is made-up people
// and posts, and production will be its own, empty project, so what is pinned
// here is where it can go:
//
//   * the hosted run names the dev project's ref on every query, so a CLI
//     linked to production one day still can't send the seed there;
//   * the local run touches only the local stack;
//   * --follow and --demo take a username and nothing else, since each is
//     written into SQL.
//
// That the seed itself applies, twice, is checked by CI against a clean local
// stack (.github/workflows/ci.yml).

export {};

const seed: {
  DEV_PROJECT_REF: string;
  DEMO_OWNER: string;
  parseArgs: (argv: string[]) => { target: 'local' | 'hosted'; follow: string | null; demo: string | null };
  queryCommand: (target: 'local' | 'hosted', file: string) => string;
  followSql: (username: string) => string;
  demoSql: (username: string, template?: string) => string;
} = require('../../scripts/seed.cjs');

describe('where the seed goes', () => {
  it('names the hosted dev project on every hosted query, never just the linked one', () => {
    expect(seed.DEV_PROJECT_REF).toBe('pyxqcqfpbaaszwmmkryc');
    expect(seed.queryCommand('hosted', 'supabase/seeds/dev.sql')).toBe(
      'npx supabase db query --linked --project-ref pyxqcqfpbaaszwmmkryc -f supabase/seeds/dev.sql',
    );
  });

  it('touches only the local stack on a local run', () => {
    expect(seed.queryCommand('local', 'supabase/seeds/dev.sql')).toBe(
      'npx supabase db query --local -f supabase/seeds/dev.sql',
    );
  });

  it.each([[[]], [['--local', '--hosted']], [['--prod']]])('refuses the arguments %p', (argv) => {
    expect(() => seed.parseArgs(argv)).toThrow();
  });

  it('reads a target and an optional account to follow', () => {
    expect(seed.parseArgs(['--hosted'])).toEqual({ target: 'hosted', follow: null, demo: null });
    expect(seed.parseArgs(['--local', '--follow', 'tanner.h'])).toEqual({ target: 'local', follow: 'tanner.h', demo: null });
    expect(seed.parseArgs(['--hosted', '--follow', 'tanner.h', '--demo', 'tanner.h'])).toEqual({
      target: 'hosted',
      follow: 'tanner.h',
      demo: 'tanner.h',
    });
  });
});

describe('--follow', () => {
  it.each(["x'); delete from public.posts; --", 'ab', 'a'.repeat(21), 'has space', ''])(
    'refuses %p, which is not a username',
    (username) => {
      expect(() => seed.parseArgs(['--hosted', '--follow', username])).toThrow('--follow takes a username');
    },
  );

  it('follows seed profiles only, and not the account itself', () => {
    const sql = seed.followSql('tanner.h');
    expect(sql).toContain("lower(username) = lower('tanner.h')");
    expect(sql).toContain("p.user_id::text like '5eed0a00-%'");
    expect(sql).toContain('p.id <> me.id');
    expect(sql).toContain('on conflict do nothing');
  });
});

describe('--demo', () => {
  it.each(["x'); delete from public.posts; --", 'ab', 'a'.repeat(21), 'has space', ''])(
    'refuses %p, which is not a username',
    (username) => {
      expect(() => seed.parseArgs(['--hosted', '--demo', username])).toThrow('--demo takes a username');
    },
  );

  it('writes the owner into every place demo.sql takes it', () => {
    const template = `select '${seed.DEMO_OWNER}'; select left('${seed.DEMO_OWNER}', 13);`;
    expect(seed.demoSql('tanner.h', template)).toBe("select 'tanner.h'; select left('tanner.h', 13);");
  });

  it('leaves no placeholder in the real file', () => {
    const sql = seed.demoSql('tanner.h');
    expect(sql).not.toContain(seed.DEMO_OWNER);
    expect(sql).toContain("pg_temp.profile_named('tanner.h')");
  });
});
