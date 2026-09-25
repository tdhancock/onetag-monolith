//
// target: __tests__/lib/cameraScan.test.ts
//
// What one QR read does on the camera tab (ONE-29). A QR code is
// attacker-controlled input, so only a real Tag is ever offered, and the
// same one only once until detection re-arms.

import { tagToOffer } from '../../lib/screens/cameraScan';
import { buildTagUrl } from '../../lib/tagLinks';

const CODE = 'ABC23XYZ';

describe('tagToOffer', () => {
  it('offers a Tag URL on the trusted host', () => {
    expect(tagToOffer(buildTagUrl(CODE), null)).toBe(CODE);
  });

  it("offers the app's own scheme", () => {
    expect(tagToOffer(`onetag://t/${CODE}`, null)).toBe(CODE);
  });

  it('ignores the code it last offered — the same QR, still in frame', () => {
    expect(tagToOffer(buildTagUrl(CODE), CODE)).toBeNull();
  });

  it('offers a different Tag even while one was last offered', () => {
    expect(tagToOffer(buildTagUrl('XYZ23ABC'), CODE)).toBe('XYZ23ABC');
  });

  it.each([
    ['a foreign host', `https://evil.example/t/${CODE}`],
    ['a lookalike host', `https://onetag.app.evil.example/t/${CODE}`],
    ['a userinfo trick', `https://onetag.app@evil.example/t/${CODE}`],
    ['plain http', `http://onetag.app/t/${CODE}`],
    ['another path on the host', `https://onetag.app/login?next=/t/${CODE}`],
    ['a malformed short code', 'https://onetag.app/t/O0l1I234'],
    ['a code of the wrong length', 'https://onetag.app/t/ABC23'],
    ['arbitrary text', 'hello there'],
    ['a Wi-Fi code', 'WIFI:S:Home;T:WPA;P:secret;;'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['nothing', ''],
  ])('ignores %s silently', (_what, scanned) => {
    expect(tagToOffer(scanned, null)).toBeNull();
  });
});
