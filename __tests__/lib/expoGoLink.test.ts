// The route inside an Expo Go link (lib/expoGoLink.ts), and the native-intent
// hook that routes a cold start to it (app/+native-intent.tsx).

jest.mock('expo-linking', () => ({ getLinkingURL: jest.fn() }));

import { getLinkingURL } from 'expo-linking';
import { expoGoLinkPath } from '../../lib/expoGoLink';
import { redirectSystemPath } from '../../app/+native-intent';

const PROJECT = '5a29bbd7-9fe3-44cc-97d6-4b51b5c8287b';
const BRANCH = '01a0e931-5580-773f-bd16-cbc54ff36a64';
const linkingUrl = getLinkingURL as jest.Mock;

describe('expoGoLinkPath', () => {
  it.each([
    [`exp://u.expo.dev/${PROJECT}/branch/${BRANCH}/--/t/DemoRig2`, '/t/DemoRig2'],
    // The form a cold start can hand the app, which expo-router routes to Home.
    [`https://u.expo.dev/${PROJECT}/branch/${BRANCH}/--/t/DemoRig2`, '/t/DemoRig2'],
    ['exp://zdzsq2u-tdhancock10-8081.exp.direct/--/t/DemoRig2', '/t/DemoRig2'],
    ['exp://192.168.1.20:8081/--/project/abc?tab=log', '/project/abc?tab=log'],
    [`exps://u.expo.dev/${PROJECT}/--//t/DemoRig2`, '/t/DemoRig2'],
  ])('reads %p as %p', (url, path) => {
    expect(expoGoLinkPath(url)).toBe(path);
  });

  it.each([
    [null],
    [''],
    // No path: opening the project, which goes Home.
    [`exp://u.expo.dev/${PROJECT}/branch/${BRANCH}`],
    ['exp://192.168.1.20:8081/--/'],
    ['exp://192.168.1.20:8081/--/?foo=bar'],
    // A real build's links: the router reads these as they are.
    ['https://red-shadow-7568.tdhancock10.workers.dev/t/DemoRig2'],
    ['onetag://t/DemoRig2'],
    ['/t/DemoRig2'],
  ])('finds no Expo Go path in %p', (url) => {
    expect(expoGoLinkPath(url)).toBeNull();
  });
});

describe('redirectSystemPath', () => {
  beforeEach(() => linkingUrl.mockReset());

  it('routes a cold start to the path in the launch URL, whatever path the router worked out', () => {
    linkingUrl.mockReturnValue(`https://u.expo.dev/${PROJECT}/branch/${BRANCH}/--/t/DemoRig2`);
    expect(redirectSystemPath({ path: 'exp://u.expo.dev/', initial: true })).toBe('/t/DemoRig2');
  });

  it("leaves a cold start alone when the launch URL has no path, or isn't Expo Go's", () => {
    linkingUrl.mockReturnValue(`exp://u.expo.dev/${PROJECT}/branch/${BRANCH}`);
    expect(redirectSystemPath({ path: '/', initial: true })).toBe('/');
    linkingUrl.mockReturnValue('onetag://t/DemoRig2');
    expect(redirectSystemPath({ path: 'onetag://t/DemoRig2', initial: true })).toBe('onetag://t/DemoRig2');
    linkingUrl.mockReturnValue(null);
    expect(redirectSystemPath({ path: '/', initial: true })).toBe('/');
  });

  it('leaves a link that arrives while the app is open to the router, which reads it right', () => {
    linkingUrl.mockReturnValue(`https://u.expo.dev/${PROJECT}/--/t/OldLink2`);
    const path = `exp://u.expo.dev/${PROJECT}/branch/${BRANCH}/--/t/DemoRig2`;
    expect(redirectSystemPath({ path, initial: false })).toBe(path);
    expect(linkingUrl).not.toHaveBeenCalled();
  });
});
