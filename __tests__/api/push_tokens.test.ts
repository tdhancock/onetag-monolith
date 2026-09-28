//
// target: __tests__/api/push_tokens.test.ts
//
// ONE-112 against the local stack: a push token for each device, not each
// account. Each device runs the app's own services/notifications.ts, signed
// in with its own session, and registers and signs out as the app does.

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({ __esModule: true, default: {}, ExecutionEnvironment: { StoreClient: 'storeClient' } }));
jest.mock('expo-notifications', () => ({ setNotificationHandler: () => undefined }));

import type { SupabaseClient } from '@supabase/supabase-js';
import { admin } from './support/localStack';
import { createAccount, deleteAccounts, signInAgain, type Account } from './support/accounts';
import { onDevice } from './support/device';

type App = typeof import('../../services/notifications');
const app = (session: SupabaseClient): App => onDevice(session, () => require('../../services/notifications') as App);

/** The tokens send-push would send an account's pushes to. */
const devicesOf = async (account: Account): Promise<string[]> => {
  const { data, error } = await admin.from('push_tokens').select('token').eq('user_id', account.userId).eq('is_active', true);
  if (error) throw error;
  return (data ?? []).map((row: { token: string }) => row.token).sort();
};

const PHONE = `ExponentPushToken[phone-${Date.now().toString(36)}]`;
const TABLET = `ExponentPushToken[tablet-${Date.now().toString(36)}]`;

let ana: Account;
let ben: Account;

beforeAll(async () => {
  [ana, ben] = await Promise.all([createAccount('ana112'), createAccount('ben112')]);
});

afterAll(() => deleteAccounts());

describe('an account signed in on two devices', () => {
  let phoneSession: SupabaseClient;
  let phone: App;

  it('gets its pushes on both', async () => {
    phoneSession = ana.client;
    phone = app(phoneSession);
    const tablet = app(await signInAgain(ana));

    await phone.savePushToken(PHONE);
    await tablet.savePushToken(TABLET);
    await phone.savePushToken(PHONE);

    expect(await devicesOf(ana)).toEqual([PHONE, TABLET].sort());
  });

  it('when someone else signs in on one device, it moves to them', async () => {
    const tabletAsBen = app(ben.client);
    await tabletAsBen.savePushToken(TABLET);

    expect(await devicesOf(ben)).toEqual([TABLET]);
    expect(await devicesOf(ana)).toEqual([PHONE]);
  });

  it('signing out on a device stops its pushes, and only its own', async () => {
    await phone.removePushToken();
    await phoneSession.auth.signOut();

    expect(await devicesOf(ana)).toEqual([]);
    expect(await devicesOf(ben)).toEqual([TABLET]);
  });
});
