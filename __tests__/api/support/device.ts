// A device running the app, for the API checks (ONE-114).
//
// Each device gets its own copy of the app's modules, signed in with its own
// session, so state the app keeps per device — the push token
// services/notifications.ts remembers for signing out — stays with that
// device. A test that imports a module with native dependencies mocks them
// first, as the unit tests do.

import type { SupabaseClient } from '@supabase/supabase-js';

/** Load app modules as a device signed in with `session`. */
export const onDevice = <T>(session: SupabaseClient, load: () => T): T => {
  let modules!: T;
  jest.isolateModules(() => {
    // Within this device's modules, the Supabase client is this session.
    (require('./liveSupabase') as typeof import('./liveSupabase')).actAs(session);
    modules = load();
  });
  return modules;
};
