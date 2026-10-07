// OneTag — the API checks (ONE-114): the app's own data layer against the
// local Supabase stack, signed in as throwaway accounts.
//
// Not part of `pnpm test`. With the local stack running (`pnpm db:start`):
//
//   pnpm check:api
//
// Every import of services/supabase.native resolves to a live client for that
// stack (__tests__/api/support/liveSupabase.ts). The harness refuses any host
// but the local one.
const base = require('./jest.config');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  testMatch: ['<rootDir>/__tests__/api/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    '(^|/)services/supabase\\.native$': '<rootDir>/__tests__/api/support/liveSupabase.ts',
    '^\\./supabase\\.native$': '<rootDir>/__tests__/api/support/liveSupabase.ts',
  },
  // One at a time: the checks share one database.
  maxWorkers: 1,
  testTimeout: 60_000,
};
