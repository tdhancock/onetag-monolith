// Supabase Edge Function: delete-user-account
//
// Deletes the signed-in account permanently: every file it uploaded, then its
// auth user and, by cascade, every profile it holds and everything they own.
// Called from Settings. What it does, and in what order, is in handler.ts.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleRequest, removeAccountMedia } from './handler.ts';
import type { MediaStorage } from './handler.ts';

// The service role reads who a token belongs to, removes files whatever their
// owner, and deletes auth users.
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});

const storage: MediaStorage = {
  async list(bucket, folder, { limit, offset }) {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(folder, { limit, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    // A folder is listed as a prefix, not an object, so it has no id.
    return (data ?? []).map((item) => ({ name: item.name, isFolder: item.id == null }));
  },

  async remove(bucket, paths) {
    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) throw error;
  },
};

Deno.serve((request) =>
  handleRequest(request, {
    async callerId(authorization) {
      const token = authorization?.replace(/^Bearer\s+/i, '');
      if (!token) return null;
      const { data, error } = await admin.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },

    removeMedia: (authUserId) => removeAccountMedia(storage, authUserId),

    async deleteUser(authUserId) {
      const { error } = await admin.auth.admin.deleteUser(authUserId);
      return error ? error.message : null;
    },

    log: (message, error) => console.error(message, error),
  }),
);
