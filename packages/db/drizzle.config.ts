import { defineConfig } from 'drizzle-kit';

// Used ONLY by `drizzle-kit generate` (SQL generation from the schema).
// `drizzle-kit push` is never used (DATA-2, denied by project settings).
export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/schema/platform.ts',
    './src/schema/iam.ts',
    './src/schema/mirror.ts',
    './src/schema/orders.ts',
    './src/schema/integration.ts',
  ],
  out: './migrations',
});
