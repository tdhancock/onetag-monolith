//
// target: __tests__/scripts/noRawHexGate.test.ts
//
// The raw-hex gate (scripts/check-no-raw-hex.sh), since M1c closed (ONE-77):
// it covers every screen and component, it passes on the repo as it stands,
// and it fails when a raw colour (hex, rgb()/hsl(), or a named colour) or an
// old-skin class is planted in a screen — unless the line says `allow-hex`.
//
// The directory list is pinned here so the gate cannot be narrowed quietly;
// narrowing it should mean changing this test too, in a reviewed diff.

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = 'scripts/check-no-raw-hex.sh';

/** The script's DIRS list, as written. */
const gatedDirs = (): string[] => {
  const source = fs.readFileSync(path.join(ROOT, SCRIPT), 'utf8');
  const match = /^DIRS="([^"]*)"/m.exec(source);
  if (!match) throw new Error('check-no-raw-hex.sh has no DIRS="…" line');
  return match[1]!.split(/\s+/).filter(Boolean);
};

/** Runs the gate from the repo root, over `paths` if given. */
const runGate = (...paths: string[]) => {
  const result = spawnSync('sh', [SCRIPT, ...paths], { cwd: ROOT, encoding: 'utf8' });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

describe('the raw-hex gate covers the whole app', () => {
  it.each(['app', 'components', 'theme', 'lib', 'features'])('gates %s/', (dir) => {
    expect(gatedDirs()).toContain(dir);
  });

  it('passes on the repo as it stands', () => {
    const { status, output } = runGate();
    expect(output).toContain('No raw colours');
    expect(status).toBe(0);
  });
});

describe('the raw-hex gate fails on a leak', () => {
  // A throwaway "screen" inside the repo: the gate is handed a relative path,
  // which every shell on every platform agrees on.
  let fixture: string;
  const screen = (name: string, source: string) => {
    const file = path.join(fixture, name);
    fs.writeFileSync(file, source);
    return path.relative(ROOT, file).split(path.sep).join('/');
  };

  beforeAll(() => {
    fixture = fs.mkdtempSync(path.join(ROOT, '.gate-fixture-'));
  });

  afterAll(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  it('on a raw hex colour', () => {
    const file = screen('Hex.tsx', "const styles = { title: { color: '#123456' } };\n");
    const { status, output } = runGate(file);
    expect(status).toBe(1);
    expect(output).toContain('Raw hex colours');
    expect(output).toContain('#123456');
  });

  it.each(['bg-black', 'bg-gray-900', 'text-white', 'text-gray-400', 'text-blue-500', 'border-gray-800'])(
    'on the old-skin class %s',
    (cls) => {
      const file = screen(`Class-${cls}.tsx`, `<View className="flex-1 ${cls} px-4" />\n`);
      const { status, output } = runGate(file);
      expect(status).toBe(1);
      expect(output).toContain('Old-skin classes');
    },
  );

  it.each([
    ['rgba()', "const scrim = { backgroundColor: 'rgba(0, 0, 0, 0.5)' };"],
    ['rgb()', 'const ink = { color: "rgb(10,10,10)" };'],
    ['hsl()', 'const tint = { color: `hsl(120, 50%, 50%)` };'],
  ])('on a raw %s colour', (kind, line) => {
    const file = screen(`Fn-${kind.replace(/\W/g, '')}.tsx`, `${line}\n`);
    const { status, output } = runGate(file);
    expect(status).toBe(1);
    expect(output).toContain('Raw rgb()/hsl() colours');
  });

  it.each([
    ['a JSX prop', '<XIcon color="white" size={24} />'],
    ['a style value', "const s = { backgroundColor: 'black' };"],
    ['any case', "const s = { color: 'Grey' };"],
  ])('on a named colour in %s', (kind, line) => {
    const file = screen(`Named-${kind.replace(/\W/g, '')}.tsx`, `${line}\n`);
    const { status, output } = runGate(file);
    expect(status).toBe(1);
    expect(output).toContain('Named colours');
  });

  it('not on transparent, withAlpha, or a colour word inside copy', () => {
    const file = screen(
      'NotColours.tsx',
      [
        "const outline = { fill: 'transparent' };",
        'const scrim = { backgroundColor: withAlpha(color.text, 0.4) };',
        "const copy = 'Black Friday';",
        "const variant = 'inverse';",
      ].join('\n') + '\n',
    );
    expect(runGate(file).status).toBe(0);
  });

  it('not on the token classes that replaced them', () => {
    const file = screen('Tokens.tsx', '<Text className="bg-bg text-text border-border text-textMid" />\n');
    expect(runGate(file).status).toBe(0);
  });

  it('not on a line marked allow-hex', () => {
    const file = screen('Allowed.tsx', "const qr = '#000000'; // allow-hex: a QR code must be pure black\n");
    expect(runGate(file).status).toBe(0);
  });

  it('on a listed path that no longer exists', () => {
    const { status, output } = runGate('app/does-not-exist');
    expect(status).toBe(1);
    expect(output).toContain('does not exist');
  });
});
