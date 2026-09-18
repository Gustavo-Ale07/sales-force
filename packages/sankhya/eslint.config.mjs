import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // ARCH-1 / P-02: only the ERP boundary package knows ERP formats, and it must not reach into
    // server, database or HTTP-framework code. Domain is imported as types only.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@salesforce/db', '@salesforce/contracts', '@salesforce/server', '@salesforce/ui', 'drizzle-orm', 'drizzle-orm/*', 'pg', 'pg-boss', '@nestjs/*'],
              message: 'packages/sankhya may depend on @salesforce/domain (types) only.',
            },
          ],
        },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': 'error',
    },
  },
);
