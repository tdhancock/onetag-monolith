//
// target: __tests__/scripts/deployFunctions.test.ts
//
// The edge functions reach production through one reviewed workflow, as the
// migrations do. Before it, nothing deployed them: a merged change to
// tag-resolve or send-push sat undeployed until someone remembered.

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'deploy-functions.yml'), 'utf8');

describe('deploy-functions', () => {
  it('runs when a function or its config changes on main', () => {
    expect(workflow).toMatch(/branches: \[main\]/);
    expect(workflow).toContain("- 'supabase/functions/**'");
    expect(workflow).toContain("- 'supabase/config.toml'");
  });

  it('waits for the production review, as the migrations do', () => {
    expect(workflow).toMatch(/environment: production/);
  });

  it('deploys every function, so a new one needs no change here', () => {
    expect(workflow).toMatch(/supabase functions deploy --project-ref/);
    expect(workflow).not.toMatch(/supabase functions deploy [a-z]/);
    // Each function that exists is one this deploys.
    expect(readdirSync(join(ROOT, 'supabase', 'functions')).sort()).toEqual(
      expect.arrayContaining(['send-push', 'tag-resolve']),
    );
  });

  it('never reads the database password, which a function deploy has no use for', () => {
    expect(workflow).not.toContain('SUPABASE_DB_PASSWORD');
  });
});
