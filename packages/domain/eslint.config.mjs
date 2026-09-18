import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      // The domain package is pure: no Node built-ins, no infrastructure (ARCH-1).
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['node:*'], message: 'Node built-ins are forbidden in domain.' }] },
      ],
    },
  },
);
