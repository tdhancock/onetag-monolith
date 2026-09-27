// Supabase Edge Function: delete-user-account
//
// Deletes the signed-in account permanently: its auth user and, by cascade,
// every profile it holds and everything they own. Called from Settings. What
// it does, and why one delete is enough, is in handler.ts.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleRequest } from './handler.ts';

// The service role deletes auth users, and reads who a token belongs to.
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((request) =>
  handleRequest(request, {
    async callerId(authorization) {
      const token = authorization?.replace(/^Bearer\s+/i, '');
      if (!token) return null;
      const { data, error } = await admin.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },

    async deleteUser(authUserId) {
      const { error } = await admin.auth.admin.deleteUser(authUserId);
      return error ? error.message : null;
    },

    log: (message, error) => console.error(message, error),
  }),
);
