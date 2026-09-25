//
// target: __tests__/modal-presentation.test.ts
//
// How a screen is presented is decided once, in app/_layout.tsx.
//
// Setting `presentation` from inside a screen only takes effect after the
// screen has been pushed as a card, and the native stack cannot turn a pushed
// screen into a modal in place: Edit profile reloaded instead of opening.
// Showing or hiding the header from inside a modal remounts the screen and
// loses its state (react-native-screens warns as much), which would clear
// the notification dots the screen captures on open. Both are pinned here by
// reading the source, because neither shows up in a render test.

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app');
const LAYOUT = path.join(APP, '_layout.tsx');

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');

/** The root stack's declared screens: name → the options literal's text. */
const declaredScreens = (): Map<string, string> => {
  const layout = fs.readFileSync(LAYOUT, 'utf8');
  const screens = new Map<string, string>();
  for (const match of layout.matchAll(/<Stack\.Screen\s+name="([^"]+)"\s+options=\{\{([^}]*)\}\}/g)) {
    screens.set(match[1], match[2]);
  }
  return screens;
};

describe('modal presentation lives in app/_layout.tsx', () => {
  const screens = sourceFiles(APP).filter((file) => path.basename(file) !== '_layout.tsx');

  it.each(screens.map((file) => [rel(file), file]))('%s does not set its own presentation', (_name, file) => {
    expect(fs.readFileSync(file, 'utf8')).not.toMatch(/\bpresentation\s*:/);
  });

  it('declares Compose and Edit profile as modals', () => {
    const declared = declaredScreens();
    expect(declared.get('compose')).toMatch(/presentation:\s*'modal'/);
    expect(declared.get('edit-profile')).toMatch(/presentation:\s*'modal'/);
  });
});

describe("a modal that shows a header declares it alongside its presentation", () => {
  const modals = [...declaredScreens()].filter(([, options]) => /presentation:/.test(options));

  it('finds the modals', () => {
    expect(modals.length).toBeGreaterThanOrEqual(5);
  });

  it.each(modals)('%s', (name, options) => {
    const file = path.join(APP, `${name}.tsx`);
    const source = fs.readFileSync(file, 'utf8');
    if (!/headerShown:\s*true/.test(source)) return;
    // Otherwise the header appears only once the screen has mounted, and the
    // screen is remounted to make room for it.
    expect(options).toMatch(/headerShown:\s*true/);
  });
});
