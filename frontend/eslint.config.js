import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // The app's own dialogs (CD-228, CD-490): askConfirm(), flash, or a Popover.
      'no-restricted-globals': ['error', ...['confirm', 'alert', 'prompt'].map((name) => ({ name, message: 'Use askConfirm(), flash or a Popover instead of a browser dialog.' }))],
      'no-restricted-properties': ['error', ...['confirm', 'alert', 'prompt'].map((property) => ({ object: 'window', property, message: 'Use askConfirm(), flash or a Popover instead of a browser dialog.' }))],
    },
  },
  {
    // askConfirm's fallback when no ConfirmHost is mounted.
    files: ['src/components/ConfirmDialog.tsx'],
    rules: { 'no-restricted-properties': 'off' },
  },
);
