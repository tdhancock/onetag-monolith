//
// target: __tests__/services/destinationSharing.test.ts
//
// Sharing a Product or a Project (ONE-40, ONE-41): the link opens the app at
// the Destination's own route, built by expo-linking from the app's scheme,
// and goes out in the form each platform's share sheet takes. It is never a
// web address on the tag host — web resolves Tags and nothing else.

const mockPlatform = { OS: 'ios' };
const mockShare = jest.fn(() => Promise.resolve());
jest.mock('react-native', () => ({
  Platform: mockPlatform,
  Share: { share: (...a: unknown[]) => mockShare(...(a as [])) },
}));

const mockCreateURL = jest.fn((path: string) => `onetag://${path}`);
jest.mock('expo-linking', () => ({ createURL: (path: string) => mockCreateURL(path) }));

import { appLinkTo, shareDestination } from '../../services/destinationSharing';
import { TAG_BASE_URL } from '../../lib/tagLinks';

beforeEach(() => {
  mockPlatform.OS = 'ios';
  mockShare.mockClear();
  mockCreateURL.mockClear();
});

describe('the link', () => {
  it("is the app's own link to the route, built from the scheme", () => {
    expect(appLinkTo('/product/pd-1')).toBe('onetag://product/pd-1');
    // A leading slash would make it `onetag:///…`; the route is passed without one.
    expect(mockCreateURL).toHaveBeenCalledWith('product/pd-1');
  });

  it('is not a web address on the tag host', () => {
    expect(appLinkTo('/project/pj-1').startsWith(TAG_BASE_URL)).toBe(false);
  });
});

describe('sharing', () => {
  it('on iOS, sends the name as the message and the link as a url', async () => {
    await shareDestination({ title: 'Oak door', route: '/product/pd-1' });
    expect(mockShare).toHaveBeenCalledWith({ message: 'Oak door', url: 'onetag://product/pd-1' });
  });

  it('on Android, puts the link in the message, since its share sheet takes text only', async () => {
    mockPlatform.OS = 'android';
    await shareDestination({ title: 'Kitchen remodel', route: '/project/pj-1' });
    expect(mockShare).toHaveBeenCalledWith({ message: 'Kitchen remodel\nonetag://project/pj-1' });
  });
});
