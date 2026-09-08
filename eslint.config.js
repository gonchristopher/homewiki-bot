// Lint is a smoke alarm here, not a style guide: no formatting rules, and
// nothing that would argue with the way the existing code is written. What it
// is for is the class of mistake this codebase can't otherwise catch -- a
// typo'd identifier, a variable left over from a refactor, a function
// accidentally defined twice -- in a repo with no type checker and no way to
// exercise the message handler without a real Telegram token.

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'template/**', 'logs/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // Unused code in a security-sensitive file is usually a half-finished
      // change. Argument lists are exempt: a signature can legitimately carry a
      // parameter it doesn't use yet.
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      // Two functions with the same name in one file: the later silently wins.
      'no-redeclare': 'error',
      'no-shadow-restricted-names': 'error',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      // An unawaited promise in the message handler is a message dropped in
      // silence, which is exactly the failure mode that is hardest to notice.
      'no-async-promise-executor': 'error',
      'require-atomic-updates': 'error',
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
];
