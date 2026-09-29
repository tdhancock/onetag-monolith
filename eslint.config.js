// ESLint, run by `npm run lint`, `npm run verify` and CI, with no warnings
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
