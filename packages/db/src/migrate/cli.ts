#!/usr/bin/env node
import { runMigrations } from './runner.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('[migrate] DATABASE_URL is not set.');
  process.exit(2);
}

try {
  await runMigrations(databaseUrl);
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[migrate] FAILED: ${message}`);
  process.exit(1);
}
