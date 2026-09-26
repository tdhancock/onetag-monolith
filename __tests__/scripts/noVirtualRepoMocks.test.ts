//
// target: __tests__/scripts/noVirtualRepoMocks.test.ts
//
// No suite virtual-mocks a module that resolves (ONE-84).
//
// jest-resolve caches module ids on a resolver every test file in a worker
// shares, keyed by (importing file, specifier) and not by whether a virtual
// mock is registered. A virtual mock registers under the extensionless path;
// a suite that loads the real module caches the resolved `.ts` path under the
// same key. Whichever suite a worker runs first fixes the id for the rest, so
// a later suite's virtual mock can silently miss and the real module loads —
// an order-dependent failure that comes and goes with worker scheduling.
//
// A non-virtual mock registers under the resolved path, so it matches however
// the module is reached. `virtual: true` is only for a module that does not
// resolve under node at all. No repo file is one, and every package the suites
// mock — react-native and the expo-* modules included — resolves too: jest
// only resolves a mocked package's path, it never runs its native code.

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const TESTS = path.join(ROOT, '__tests__');

/** What jest.config.js resolves an extensionless specifier to. */
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json'];

interface MockCall {
  file: string;
  line: number;
  specifier: string;
  virtual: boolean;
}

const testSources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return testSources(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });

/**
 * Index just past the `)` closing the call whose `(` is at `open`, skipping
 * strings, template literals and comments — a factory's body is arbitrary
 * code, and a paren inside a string must not end the call.
 */
const closingParen = (source: string, open: number): number => {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') {
      i = source.indexOf('\n', i);
      if (i < 0) return source.length;
    } else if (ch === '/' && source[i + 1] === '*') {
      i = source.indexOf('*/', i + 2) + 1;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < source.length && source[i] !== ch; i++) {
        if (source[i] === '\\') i++;
      }
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return source.length;
};

/** Every `jest.mock('<specifier>', …)` in a file, and whether it is virtual. */
const mockCalls = (file: string, source: string = fs.readFileSync(file, 'utf8')): MockCall[] => {
  const calls: MockCall[] = [];
  const pattern = /jest\.mock\(\s*(['"])([^'"]+)\1/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const open = match.index + 'jest.mock'.length;
    const call = source.slice(open, closingParen(source, open));
    calls.push({
      file,
      line: source.slice(0, match.index).split('\n').length,
      specifier: match[2]!,
      virtual: /virtual\s*:\s*true/.test(call),
    });
  }
  return calls;
};

/** The repo file a relative specifier names, or null when it names none. */
const repoFileFor = (fromFile: string, specifier: string): string | null => {
  if (!specifier.startsWith('.')) return null;
  const target = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    target,
    ...EXTENSIONS.map((ext) => target + ext),
    ...EXTENSIONS.map((ext) => path.join(target, `index${ext}`)),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
};

/** Whether a package specifier resolves from `fromFile`, as jest would resolve it. */
const packageResolves = (fromFile: string, specifier: string): boolean => {
  if (specifier.startsWith('.')) return false;
  try {
    require.resolve(specifier, { paths: [path.dirname(fromFile)] });
    return true;
  } catch {
    return false;
  }
};

const describeCall = (call: MockCall) =>
  `${path.relative(ROOT, call.file).split(path.sep).join('/')}:${call.line} ${call.specifier}`;

describe('the mock scanner', () => {
  const here = path.join(TESTS, 'features', 'x.test.ts');

  it('reads a multi-line virtual mock', () => {
    const source = [
      "jest.mock(",
      "  '../../services/supabase.native',",
      "  () => ({ supabase: { from: jest.fn(() => ')') } }),",
      "  { virtual: true },",
      ");",
      "jest.mock('react-native', () => ({}));",
    ].join('\n');
    expect(mockCalls(here, source)).toEqual([
      { file: here, line: 1, specifier: '../../services/supabase.native', virtual: true },
      { file: here, line: 6, specifier: 'react-native', virtual: false },
    ]);
  });

  it('does not carry one call’s options onto the next', () => {
    const source = "jest.mock('./a', () => ({}));\njest.mock('./b', () => ({}), { virtual: true });";
    expect(mockCalls(here, source).map((call) => call.virtual)).toEqual([false, true]);
  });

  it('resolves a relative specifier to the repo file it names', () => {
    expect(repoFileFor(here, '../../services/supabase.native')).toBe(
      path.join(ROOT, 'services', 'supabase.native.ts'),
    );
    expect(repoFileFor(here, '../../features/profiles')).toBe(
      path.join(ROOT, 'features', 'profiles', 'index.ts'),
    );
    expect(repoFileFor(here, '../../services/does-not-exist')).toBeNull();
    expect(repoFileFor(here, 'react-native')).toBeNull();
  });

  it('tells an installed package from one that is not', () => {
    expect(packageResolves(here, 'react-native')).toBe(true);
    expect(packageResolves(here, 'not-a-package-onetag-installs')).toBe(false);
  });
});

describe('no suite virtual-mocks a module that resolves', () => {
  const calls = testSources(TESTS).flatMap((file) => mockCalls(file));

  it('finds the suites’ mocks at all', () => {
    // Guards the guard: a scanner that matched nothing would pass forever.
    expect(calls.filter((call) => repoFileFor(call.file, call.specifier)).length).toBeGreaterThan(50);
    expect(calls.filter((call) => packageResolves(call.file, call.specifier)).length).toBeGreaterThan(50);
  });

  it('mocks every repo file without `virtual: true`', () => {
    const offenders = calls.filter((call) => call.virtual && repoFileFor(call.file, call.specifier));
    expect(offenders.map(describeCall)).toEqual([]);
  });

  it('mocks every installed package without `virtual: true`', () => {
    const offenders = calls.filter((call) => call.virtual && packageResolves(call.file, call.specifier));
    expect(offenders.map(describeCall)).toEqual([]);
  });
});
