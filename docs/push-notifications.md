# Push notifications

How a notification becomes a push on someone's phone (ONE-103), and how to
turn it on in production.

## How it works

1. The app registers the device's Expo push token for the signed-in account
   with `register_push_token()` (`services/notifications.ts`). `push_tokens`
   has a row per device, keyed by the token: an account signed in on a phone
   and a tablet has two, and a device that signs in to another account moves
   to it. Signing out deletes the device's row first.
   (`supabase/migrations/20260928190000_push_tokens_per_device.sql`)
2. When a `notifications` row of a type that pushes is written (`follow`,
   `follow_request`, `comment`, `mention`), or a `messages` row, a trigger
   calls `request_push()`. That queues a POST through `pg_net` to the
   `send-push` edge function: `{ "kind": "notification" | "message", "id": … }`,
   with a shared secret in `x-push-secret`.
   (`supabase/migrations/20260928130000_push_notifications.sql`)
3. `pg_net` sends it after the transaction commits, from a background worker.
   The insert never waits on the network, and a failure to queue never fails
   the insert.
4. `send-push` loads the row with the service role, looks up the receiving
   account's tokens, and sends to each of its devices through Expo. A token
   Expo reports as `DeviceNotRegistered` is deleted.
   (`supabase/functions/send-push`)
5. A tapped push is routed in `app/_layout.tsx`: a follow opens the sender's
   profile, a follow request opens Follow requests, a comment or mention opens
   the post, and a message opens the thread with the sender.

The text is the Notifications screen's own sentence. A message's push says who
it's from, never what it says. Likes, reposts, comment likes and OneSnap likes
don't push.

Until both Vault secrets below exist, `request_push()` does nothing. That's why
the local stack and the test suite never send anything.

## Turning it on in production

Do this once, after the migration has deployed. Generate a long random secret
first, for example with `openssl rand -hex 32`.

1. **Deploy the function and give it the secret.**

   ```
   supabase secrets set PUSH_WEBHOOK_SECRET=<the secret>
   supabase functions deploy send-push
   ```

   After this first time, a merge that changes the function deploys it
   through the `deploy-functions` workflow. `verify_jwt = false` comes from
   `supabase/config.toml`: the database calls it with the shared secret, not
   a JWT.

   If the Expo project has *Enhanced push security* on, also run
   `supabase secrets set EXPO_ACCESS_TOKEN=<token from expo.dev>`.

2. **Tell the database where to send.** In the SQL editor for the project
   (these are secrets, so they don't go in a migration):

   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/send-push', 'send_push_url');
   select vault.create_secret('<the same secret>', 'send_push_secret');
   ```

3. **Check it.** Follow a test account from another one, then look at the
   latest responses:

   ```sql
   select status_code, content, created from net._http_response order by created desc limit 5;
   ```

   Each should be `200` with `{"sent":1}` for a receiver signed in on one
   device, and one more for each other device. `{"sent":0}` means the
   receiving account has no device registered.

To rotate the secret, change it in both places: `supabase secrets set …`, and
`select vault.update_secret(id, '<new>') from vault.secrets where name = 'send_push_secret';`.
To turn pushes off, delete either Vault secret.

## Verifying locally

The Jest suite (`__tests__/supabase/sendPush.test.ts`) and pgTAP
(`supabase/tests/push_notifications.test.sql`) run with the rest. To see a push
travel the whole way without reaching Expo:

1. Run a stand-in for Expo's endpoint on the host, port 8787, that answers
   `{"data":[{"status":"ok"}]}`.
2. Write an env file with `PUSH_WEBHOOK_SECRET=<anything>` and
   `EXPO_PUSH_URL=http://host.docker.internal:8787/push`, then run
   `npx supabase functions serve send-push --env-file <that file>`.
3. In the local database, create the two Vault secrets with
   `http://host.docker.internal:54321/functions/v1/send-push` and the same
   secret.
4. Have one throwaway account follow another that has a `push_tokens` row,
   and watch the stand-in receive it. (Clients can't write notifications
   since ONE-107; the follow writes it.)

Delete the Vault secrets afterwards, or `npm run db:reset`.
