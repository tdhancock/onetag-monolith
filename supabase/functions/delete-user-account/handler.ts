// Account deletion: the request handler, kept free of Deno so Jest can run it.
// index.ts wires it to Supabase. Called from Settings.
//
// Deleting the auth user is the whole job (ONE-88). Each profile belongs to
// its account through profiles.user_id ON DELETE CASCADE, and everything a
// profile owns references the profile the same way. So one delete removes the
// account's profiles, Individual and Business alike, and everything they own,
// in a single transaction that lands whole or not at all.
//
// It used to delete table by table first, by the auth user's id. Since
// ONE-21 those tables are keyed by profile id, so the loop matched nothing but
// the profiles row, and one failure half-way left an account half deleted.
//
// Two references outlive the account on purpose, set to null rather than
// deleted: a scan it made stays in the tag owner's counts, anonymous
// (scans.scanner_profile_id), and a message between two other people that
// shared its profile keeps its text (messages.shared_profile_id).
// supabase/tests/account_deletion.test.sql deletes a two-profile account
// against a real database, and __tests__/supabase/delete-user-account.test.ts
// checks that every migration's foreign key to a profile or an account says
// what happens on delete.
//
// Uploaded files are not rows. Storage objects have no foreign key to the
// account, so the cascade leaves them behind (ONE-99).

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export interface AccountDeletion {
  /** The auth user the request's bearer token belongs to, or null when it isn't a signed-in user's. */
  callerId(authorization: string | null): Promise<string | null>;
  /** Delete an auth user, and by cascade everything its account holds. Resolves to an error message, or null. */
  deleteUser(authUserId: string): Promise<string | null>;
  log?: (message: string, error: unknown) => void;
}

const json = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Delete the caller's own account, and only ever the caller's. */
export const handleRequest = async (request: Request, deps: AccountDeletion): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authUserId = await deps.callerId(request.headers.get('Authorization'));
    if (!authUserId) return json(401, { error: 'Not authenticated' });

    const failure = await deps.deleteUser(authUserId);
    if (failure) return json(500, { error: 'Failed to delete auth user', details: failure });

    return json(200, { success: true, message: 'Account permanently deleted' });
  } catch (error) {
    deps.log?.('delete-user-account failed', error);
    return json(500, { error: 'Internal server error', details: String(error) });
  }
};
