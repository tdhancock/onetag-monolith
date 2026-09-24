//
// target: __tests__/services/supabaseClient.test.ts
//
// The Supabase client's auth configuration. The SDK owns token refresh:
// with `autoRefreshToken` it refreshes in the background and fires
// TOKEN_REFRESHED, or SIGNED_OUT once the refresh token is gone, and
// AppContext reacts to those events (covered in useAppContext.test.tsx).
// Turning either flag off would quietly break that contract.
//
// Moved here from auth-expired-token.test.ts, whose other cases tested its
// own mock rather than app code, and asserted against the options actually
// passed to `createClient` instead of the file's text.

const mockCreateClient = jest.fn(() => ({ auth: {} }));

jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

describe('services/supabase.native', () => {
  it('lets the SDK refresh tokens and persist the session in AsyncStorage', () => {
    let AsyncStorage: unknown;
    jest.isolateModules(() => {
      require('../../services/supabase.native');
      AsyncStorage = require('@react-native-async-storage/async-storage').default;
    });

    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    const [, , options] = mockCreateClient.mock.calls[0] as unknown as [string, string, { auth: Record<string, unknown> }];
    expect(options.auth).toMatchObject({
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // A native app has no URL to read a session from.
      detectSessionInUrl: false,
    });
  });
});
