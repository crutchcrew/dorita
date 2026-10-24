'use strict';

const neostandard = require('neostandard');

module.exports = [
  ...neostandard({ semi: true, ignores: ['coverage/**', ...neostandard.resolveIgnoresFromGitignore()] }),
  {
    files: ['web/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { window: 'readonly', document: 'readonly', EventSource: 'readonly', ResizeObserver: 'readonly', requestAnimationFrame: 'readonly', getComputedStyle: 'readonly' }
    }
  },
  {
    rules: {
      'no-unused-vars': ['warn', { vars: 'all', args: 'after-used', caughtErrors: 'none' }],
      // Not enforced by the previous semistandard setup; kept off to avoid
      // restyling the existing library code.
      '@stylistic/quote-props': 'off',
      '@stylistic/object-curly-spacing': 'off',
      'no-var': 'off',
      'prefer-const': 'off',
      'object-shorthand': 'off',
      'no-prototype-builtins': 'off',
      'array-callback-return': 'off'
    }
  }
];
