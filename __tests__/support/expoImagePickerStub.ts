// Shared `expo-image-picker` stub. The real module is ESM and reaches for
// the native bridge, neither of which survives the `node` test environment.
//
// The exports are `jest.fn()`s so a suite can drive them directly:
//
//   jest.mock('expo-image-picker', () => require('../support/expoImagePickerStub'), { virtual: true });
//   import { launchImageLibraryAsync } from '../support/expoImagePickerStub';
//
// jest.mock hands back this same module instance, so the mock the suite
// configures is the one the code under test calls. Suites that only need the
// module to load can mock it and ignore the functions.

export const launchImageLibraryAsync = jest.fn();
export const launchCameraAsync = jest.fn();
export const requestCameraPermissionsAsync = jest.fn();
export const requestMediaLibraryPermissionsAsync = jest.fn();

/** Reset every mock. Call from `beforeEach` when a suite drives them. */
export function resetImagePickerMocks(): void {
  launchImageLibraryAsync.mockReset();
  launchCameraAsync.mockReset();
  requestCameraPermissionsAsync.mockReset();
  requestMediaLibraryPermissionsAsync.mockReset();
}
