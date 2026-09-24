//
// target: __tests__/lib/tagLinks.test.ts
//
// The Tag URL contract (ONE-28). These URLs are printed onto physical
// stickers, and a QR code is attacker-controlled input, so the parser is
// pinned from both sides: every form a real Tag arrives in, and the forms a
// forged one would try.

import {
  buildTagUrl,
  parseTagUrl,
  resolveTagBaseUrl,
  isValidShortCode,
  TAG_BASE_URL,
  TAG_PATH_PREFIX,
  TAG_SHORT_CODE_ALPHABET,
  TAG_SHORT_CODE_LENGTH,
} from '../../lib/tagLinks';

const CODE = 'ABC23XYZ';

describe('buildTagUrl', () => {
  it('builds from the default base', () => {
    expect(TAG_BASE_URL).toBe('https://onetag.app');
    expect(buildTagUrl(CODE)).toBe('https://onetag.app/t/ABC23XYZ');
    expect(TAG_PATH_PREFIX).toBe('t');
  });

  it('uses EXPO_PUBLIC_TAG_BASE_URL when it is set', () => {
    const previous = process.env.EXPO_PUBLIC_TAG_BASE_URL;
    process.env.EXPO_PUBLIC_TAG_BASE_URL = 'https://onetag.co/';
    try {
      jest.isolateModules(() => {
        const isolated = require('../../lib/tagLinks') as typeof import('../../lib/tagLinks');
        expect(isolated.TAG_BASE_URL).toBe('https://onetag.co');
        expect(isolated.buildTagUrl(CODE)).toBe('https://onetag.co/t/ABC23XYZ');
        expect(isolated.parseTagUrl('https://onetag.co/t/ABC23XYZ')).toEqual({ shortCode: CODE });
        // The default host is no longer trusted once another is configured.
        expect(isolated.parseTagUrl('https://onetag.app/t/ABC23XYZ')).toBeNull();
      });
    } finally {
      if (previous === undefined) delete process.env.EXPO_PUBLIC_TAG_BASE_URL;
      else process.env.EXPO_PUBLIC_TAG_BASE_URL = previous;
    }
  });

  it('falls back to the default for a blank value and drops trailing slashes', () => {
    expect(resolveTagBaseUrl(undefined)).toBe('https://onetag.app');
    expect(resolveTagBaseUrl('   ')).toBe('https://onetag.app');
    expect(resolveTagBaseUrl('https://onetag.co//')).toBe('https://onetag.co');
  });
});

describe('parseTagUrl — accepted forms', () => {
  it.each([
    ['universal link', 'https://onetag.app/t/ABC23XYZ'],
    ['custom scheme', 'onetag://t/ABC23XYZ'],
    ['trailing slash', 'https://onetag.app/t/ABC23XYZ/'],
    ['custom scheme, trailing slash', 'onetag://t/ABC23XYZ/'],
    ['query string', 'https://onetag.app/t/ABC23XYZ?utm_source=sticker'],
    ['fragment', 'https://onetag.app/t/ABC23XYZ#top'],
    ['mixed-case host', 'https://OneTag.APP/t/ABC23XYZ'],
    ['surrounding whitespace', '  https://onetag.app/t/ABC23XYZ\n'],
  ])('%s', (_label, url) => {
    expect(parseTagUrl(url)).toEqual({ shortCode: CODE });
  });

  it('keeps the code exactly as printed — codes are case-sensitive', () => {
    expect(parseTagUrl('https://onetag.app/t/abc23xyz')).toEqual({ shortCode: 'abc23xyz' });
  });
});

describe('parseTagUrl — rejected forms', () => {
  it.each([
    ['a foreign host', 'https://evil.example/t/ABC23XYZ'],
    ['a look-alike subdomain', 'https://onetag.app.evil.example/t/ABC23XYZ'],
    ['a subdomain of the real host', 'https://www.onetag.app/t/ABC23XYZ'],
    ['plain http', 'http://onetag.app/t/ABC23XYZ'],
    ['a different port', 'https://onetag.app:8443/t/ABC23XYZ'],
    ['another scheme', 'javascript://t/ABC23XYZ'],
    ['another path', 'https://onetag.app/post/ABC23XYZ'],
    ['no code', 'https://onetag.app/t/'],
    ['an extra segment', 'https://onetag.app/t/ABC23XYZ/extra'],
    ['a nested prefix', 'https://onetag.app/x/t/ABC23XYZ'],
    ['not a URL', 'ABC23XYZ'],
    ['empty', ''],
  ])('%s', (_label, url) => {
    expect(parseTagUrl(url)).toBeNull();
  });

  it.each(['0', 'O', '1', 'I', 'l'])('a code containing the ambiguous glyph %s', (glyph) => {
    const code = `ABC2${glyph}XYZ`;
    expect(parseTagUrl(`https://onetag.app/t/${code}`)).toBeNull();
    expect(parseTagUrl(`onetag://t/${code}`)).toBeNull();
  });

  it.each([
    ['too short', 'ABC23XY'],
    ['too long', 'ABC23XYZA'],
    ['punctuation', 'ABC23XY-'],
    ['percent-encoded', 'ABC23X%20'],
  ])('a malformed code: %s', (_label, code) => {
    expect(parseTagUrl(`https://onetag.app/t/${code}`)).toBeNull();
  });
});

describe('short codes', () => {
  it('draw from an alphabet without 0, O, 1, I or l', () => {
    for (const glyph of ['0', 'O', '1', 'I', 'l']) {
      expect(TAG_SHORT_CODE_ALPHABET).not.toContain(glyph);
    }
    expect(new Set(TAG_SHORT_CODE_ALPHABET).size).toBe(TAG_SHORT_CODE_ALPHABET.length);
    expect(TAG_SHORT_CODE_LENGTH).toBe(8);
  });

  it('validate by shape', () => {
    expect(isValidShortCode(CODE)).toBe(true);
    expect(isValidShortCode('ABC1IXYZ')).toBe(false);
  });
});

describe('round trip', () => {
  it('parses back exactly what it builds, for any valid code', () => {
    const alphabet = TAG_SHORT_CODE_ALPHABET;
    for (let i = 0; i < 200; i++) {
      let code = '';
      for (let j = 0; j < TAG_SHORT_CODE_LENGTH; j++) {
        code += alphabet[(i * 7 + j * 13) % alphabet.length];
      }
      expect(parseTagUrl(buildTagUrl(code))).toEqual({ shortCode: code });
    }
  });
});
