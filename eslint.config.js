// ESLint, run by `pnpm lint`, `pnpm verify` and CI, with no warnings
// allowed through.
//
// Expo's config, with the two classic hooks rules as errors. A OneSnap
// viewer whose gesture handler kept its first render's callbacks, so tapping
// forward closed it, is what `react-hooks/exhaustive-deps` exists to catch;
// it shipped because nothing here linted at all. A dependency left out on
// purpose gets a disable comment for that rule on the line above it, saying
// why.

const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// The rest of the hooks plugin's recommended set checks code for the React
// Compiler, which the app doesn't use. Its rules (`refs`, which forbids the
// latest-callback ref above; `set-state-in-effect`, …) would fail patterns
// that are correct without the compiler.
const REACT_COMPILER_RULES = [
  'static-components',
  'use-memo',
  'preserve-manual-memoization',
  'incompatible-library',
  'immutability',
  'globals',
  'refs',
  'set-state-in-effect',
  'error-boundaries',
  'purity',
  'set-state-in-render',
  'unsupported-syntax',
  'config',
  'gating',
];

// The feature-folder rules (features/README.md), enforced rather than
// remembered. Six screens once fetched in an effect beside query hooks that
// already existed: uncached, and never refetched.
const BARREL_ONLY = {
  regex: '(^|/)features/[^/]+/.+',
  message: 'Import a feature from its barrel, features/<domain>, never a file inside it.',
};
const READS_THROUGH_HOOKS = {
  regex: '(^|/)features/[^/]+$',
  importNamePattern: '^(get|fetch|search)[A-Z]',
  message: "Read the server through the feature's query hook, so it is cached and refetched. Add the hook if there isn't one.",
};
// From inside features/<domain>/, another feature is a sibling folder.
const SIBLING_FEATURE_FILE = {
  regex: '^\\.\\./(?!\\.\\.)[^/]+/.+',
  message: 'Import another feature from its barrel, ../<domain>, never a file inside it.',
};
const SIBLING_FEATURE = {
  regex: '^\\.\\./(?!\\.\\.)[^/]+',
  message: "api.ts imports nothing from another feature. Move what they share to services/.",
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['node_modules/**', 'dist/**', '.expo/**', 'supabase/functions/**', 'coverage/**'],
  },
  {
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      ...Object.fromEntries(REACT_COMPILER_RULES.map((rule) => [`react-hooks/${rule}`, 'off'])),
      // Copy is written with apostrophes and quotes, as people read it.
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    files: ['app/**', 'components/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [BARREL_ONLY, READS_THROUGH_HOOKS] }] },
  },
  {
    files: ['lib/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [BARREL_ONLY] }] },
  },
  {
    files: ['features/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [SIBLING_FEATURE_FILE] }] },
  },
  {
    files: ['features/*/api.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [SIBLING_FEATURE] }] },
  },
  {
    // Query keys are built only in a feature's keys.ts, by its factory.
    files: ['app/**', 'components/**', 'lib/**', 'features/**', 'store/**', 'services/**'],
    ignores: ['features/*/keys.ts', 'lib/queryKeys.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='queryKey'] > ArrayExpression",
          message: "Build query keys in the feature's keys.ts, never as an array here.",
        },
      ],
    },
  },
  {
    // Jest hoists jest.mock above the imports, and its factories must
    // require() what they build, often a component made on the spot or a
    // hook called outside one. None of that is app code.
    files: ['__tests__/**', 'jest.setup.*'],
    rules: {
      'import/first': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'react/display-name': 'off',
      'react-hooks/rules-of-hooks': 'off',
    },
  },
]);
