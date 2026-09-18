/**
 * Generates (or with --check, verifies) the committed OpenAPI document and the client types:
 *   packages/contracts/openapi/openapi.json          <- route registry + Zod schemas
 *   packages/contracts/src/generated/api-types.ts    <- openapi-typescript over the document
 * Usage: tsx scripts/generate-openapi.ts [--check]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString, type OpenAPI3 } from 'openapi-typescript';
import { buildOpenApiDocument, serializeOpenApi } from '../src/openapi.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const openapiPath = resolve(root, 'openapi/openapi.json');
const typesPath = resolve(root, 'src/generated/api-types.ts');

const HEADER = `/**
 * GENERATED FILE - do not edit. Source: packages/contracts/openapi/openapi.json
 * (built from the Zod contracts). Regenerate with: pnpm --filter @salesforce/contracts run openapi
 */

`;

export async function generate(): Promise<{ openapi: string; types: string }> {
  const document = buildOpenApiDocument();
  const openapi = serializeOpenApi(document);
  const ast = await openapiTS(document as unknown as OpenAPI3, { alphabetize: false });
  const types = HEADER + astToString(ast).replace(/\r\n/g, '\n');
  return { openapi, types: types.endsWith('\n') ? types : `${types}\n` };
}

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const { openapi, types } = await generate();

  if (check) {
    const stale: string[] = [];
    if (read(openapiPath) !== openapi) stale.push('openapi/openapi.json');
    if (read(typesPath) !== types) stale.push('src/generated/api-types.ts');
    if (stale.length > 0) {
      console.error(`Stale generated contract files: ${stale.join(', ')}`);
      console.error('Run: pnpm --filter @salesforce/contracts run openapi');
      process.exit(1);
    }
    console.log('OpenAPI document and client types are current.');
    return;
  }

  mkdirSync(dirname(openapiPath), { recursive: true });
  mkdirSync(dirname(typesPath), { recursive: true });
  writeFileSync(openapiPath, openapi, 'utf8');
  writeFileSync(typesPath, types, 'utf8');
  console.log('Wrote openapi/openapi.json and src/generated/api-types.ts');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
