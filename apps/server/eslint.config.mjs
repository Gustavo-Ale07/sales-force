import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // Structured logging only (pino). Entry-point fatal messages use process.stderr directly.
      'no-console': 'error',
    },
  },
  {
    // ARCH-1 / STACK-3: the server orchestrates; business rules live in packages/domain.
    // Nothing in the server reaches into another package's source.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@salesforce/*/src/*', '@salesforce/*/dist/*'],
              message: 'Import packages through their public entry point only.',
            },
          ],
        },
      ],
    },
  },
);
