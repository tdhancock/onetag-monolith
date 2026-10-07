//
// target: __tests__/lib/signInReturn.test.ts
//
// Where signing in comes back to (ONE-139): a route left by a screen that
// sent someone to sign in, taken once in place of home.

import { returnAfterSignIn, takeReturnAfterSignIn } from '../../lib/signInReturn';

describe('the route to come back to after signing in', () => {
  it('is nothing unless a screen left one, so signing in goes home', () => {
    expect(takeReturnAfterSignIn()).toBeNull();
  });

  it('is the route left, taken once', () => {
    returnAfterSignIn('/t/BLANK234');
    expect(takeReturnAfterSignIn()).toBe('/t/BLANK234');
    expect(takeReturnAfterSignIn()).toBeNull();
  });

  it('is the latest route left, when more than one was', () => {
    returnAfterSignIn('/t/BLANK234');
    returnAfterSignIn('/t/BLANK345');
    expect(takeReturnAfterSignIn()).toBe('/t/BLANK345');
  });
});
