//
// target: __tests__/scripts/noVirtualRepoMocks.test.ts
//
// No suite uses a virtual mock (ONE-84).
//
// A virtual mock of a module that resolves is a flake. jest-resolve caches
// module ids on a resolver every test file in a worker shares, keyed by
// (importing file, specifier) and not by whether a virtual mock is registered.
// A virtual mock registers under the extensionless path; a suite that loads
// the real module caches the resolved `.ts` path under the same key. Whichever
// suite a worker runs first fixes the id for the rest, so a later suite's
// virtual mock can silently miss and the real module loads — an
// order-dependent failure that comes and goes with worker scheduling. A
// non-virtual mock registers under the resolved path, so it matches however
// the module is reached.
//
// A virtual mock of a module that does not resolve mocks something no app code
// imports, so the suite can only be testing its own mock. The last one did
// exactly that and was deleted.
//
// Every repo file resolves, and so does every package the suites mock —
// react-native and the expo-* modules included: jest only resolves a mocked
// package's path, it never runs its native code. So the rule is simply: none.

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const TESTS = path.join(ROOT, '__tests__');

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
});

describe('no suite uses a virtual mock', () => {
  const calls = testSources(TESTS)
    .filter((file) => file !== __filename)
    .flatMap((file) => mockCalls(file));

  it('finds the suites’ mocks at all', () => {
    // Guards the guard: a scanner that matched nothing would pass forever.
    expect(calls.length).toBeGreaterThan(200);
  });

  it('mocks every module without `virtual: true`', () => {
    const offenders = calls
      .filter((call) => call.virtual)
      .map((call) => `${path.relative(ROOT, call.file).split(path.sep).join('/')}:${call.line} ${call.specifier}`);
    expect(offenders).toEqual([]);
  });
});
