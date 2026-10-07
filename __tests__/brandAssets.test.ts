// target: __tests__/brandAssets.test.ts
//
// The app's images and brand colours carry the two-ring mark (ONE-133). The
// rings-and-star mark they replaced came with the repo as two unused rasters,
// and a later change redrew every icon from them because of their file name.
// This pins what replaced them, so nothing quietly brings it back.

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');

/** app.json's `expo` object. */
const expo = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo;

const plugin = (name: string): Record<string, unknown> => {
  const entry = (expo.plugins as unknown[]).find((p) => Array.isArray(p) && p[0] === name) as
    | [string, Record<string, unknown>]
    | undefined;
  if (!entry) throw new Error(`no ${name} plugin in app.json`);
  return entry[1];
};

/** A PNG's width, height and colour type, from its IHDR chunk. */
const pngHeader = (file: string) => {
  const bytes = fs.readFileSync(path.join(ASSETS, file));
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colourType: bytes[25] };
};

const RGB = 2;
const RGBA = 6;

describe('the retired mark is gone', () => {
  it('leaves no onetag-logo image in assets/', () => {
    expect(fs.readdirSync(ASSETS).filter((f) => f.startsWith('onetag-logo'))).toEqual([]);
  });

  it('leaves no icon.svg, its earlier draft, at the root', () => {
    expect(fs.existsSync(path.join(ROOT, 'icon.svg'))).toBe(false);
  });

  it('leaves its blue out of app.json and the notification channel', () => {
    expect(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).not.toContain('3b82f6');
    expect(fs.readFileSync(path.join(ROOT, 'services', 'notifications.ts'), 'utf8')).not.toContain('3b82f6');
  });
});

describe('app.json', () => {
  it('sets the launch screen and the adaptive icon on white, the light skin\'s ground', () => {
    expect(expo.android.adaptiveIcon.backgroundColor).toBe('#ffffff');
    expect(plugin('expo-splash-screen').backgroundColor).toBe('#ffffff');
  });

  it('tints notifications near-black, the mark\'s ink', () => {
    expect(plugin('expo-notifications').color).toBe('#0a0a0a');
  });

  it('points at the same image files as before', () => {
    expect(expo.icon).toBe('./assets/icon.png');
    expect(expo.android.adaptiveIcon.foregroundImage).toBe('./assets/adaptive-icon.png');
    expect(plugin('expo-splash-screen').image).toBe('./assets/splash-icon.png');
    expect(plugin('expo-notifications').icon).toBe('./assets/notification-icon.png');
  });
});

describe('the images', () => {
  it('draws the app icon opaque, 1024 square', () => {
    expect(pngHeader('icon.png')).toEqual({ width: 1024, height: 1024, colourType: RGB });
  });

  it.each([
    ['adaptive-icon.png', 1024],
    ['splash-icon.png', 1024],
    ['notification-icon.png', 96],
  ])('draws %s on transparent, %i square', (file, size) => {
    expect(pngHeader(file)).toEqual({ width: size, height: size, colourType: RGBA });
  });
});
