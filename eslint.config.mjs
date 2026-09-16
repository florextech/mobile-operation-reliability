import js from '@eslint/js';
import ts from 'typescript-eslint';

export default ts.config(
  { ignores: ['**/dist/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { files: ['**/*.mjs'], languageOptions: { globals: { structuredClone: 'readonly' } } },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-globals': ['error', 'fetch', 'Date', 'setTimeout', 'setInterval', 'performance', 'crypto'],
      'no-restricted-imports': ['error', { patterns: ['node:*', 'react*', 'expo*', '*sqlite*', 'axios', '*netinfo*'] }],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Inject a sample into the pure policy.' }]
    }
  }
);
