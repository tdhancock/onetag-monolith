//
// target: __tests__/features/admin/admin.test.ts
//
// The admin flag (ONE-20). It used to be read off `profiles.is_admin` inside
// AppContext at sign-in; it is now a query over `public.is_admin()`, the same
// function every admin RLS policy calls, so the client cannot believe someone
// is an admin that the database does not.

const mockRpc = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../../../services/supabase.native', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({
      update: (row: unknown) => {
        mockUpdate(row);
        return { eq: () => ({ select: async () => mockUpdateResult }) };
      },
    }),
  },
}));

let mockUpdateResult: { data: unknown[] | null; error: unknown } = { data: [{ id: 'p1' }], error: null };

import { fetchIsAdmin, setUserVerified } from '../../../features/admin/api';

beforeEach(() => {
  mockRpc.mockReset();
  mockUpdate.mockReset();
  mockUpdateResult = { data: [{ id: 'p1' }], error: null };
});

describe('fetchIsAdmin', () => {
  it('asks the database through is_admin()', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    await expect(fetchIsAdmin()).resolves.toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('is_admin');
  });

  it('is false for anything but an explicit true, including an error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchIsAdmin()).resolves.toBe(false);

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockRpc.mockResolvedValue({ data: null, error: { message: 'denied' } });
    await expect(fetchIsAdmin()).resolves.toBe(false);
    errorSpy.mockRestore();
  });
});

describe('setUserVerified', () => {
  it('writes the verified flag', async () => {
    await setUserVerified('p1', true);
    expect(mockUpdate).toHaveBeenCalledWith({ is_verified: true });
  });

  it('fails loudly when RLS lets nothing through', async () => {
    mockUpdateResult = { data: [], error: null };
    await expect(setUserVerified('p1', true)).rejects.toThrow(/No rows modified/);
  });
});
