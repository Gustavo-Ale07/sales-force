import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const srcDir = join(root, 'src');

function listTs(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'generated' ? [] : listTs(full);
    return entry.endsWith('.ts') ? [full] : [];
  });
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

interface Import {
  spec: string;
  typeOnly: boolean;
}

function importsOf(text: string): Import[] {
  const out: Import[] = [];
  const re = /\b(import|export)\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const match of stripComments(text).matchAll(re)) {
    out.push({ spec: match[3] as string, typeOnly: match[2] !== undefined });
  }
  return out;
}

const files = listTs(srcDir).map((file) => ({
  file,
  name: relative(srcDir, file).split(sep).join('/'),
  text: readFileSync(file, 'utf8'),
}));

describe('contracts dependency boundary', () => {
  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it('imports only relative files, zod, @salesforce/domain and (client entry only) openapi-fetch', () => {
    for (const { name, text } of files) {
      for (const { spec } of importsOf(text)) {
        if (spec.startsWith('./') || spec === 'zod') continue;
        if (spec === '@salesforce/domain') continue;
        if (spec === 'openapi-fetch' && name === 'client.ts') continue;
        throw new Error(`${name}: forbidden import "${spec}"`);
      }
    }
  });

  it('never imports Node built-ins, server, db, sankhya or framework packages (browser-safe entry)', () => {
    for (const { name, text } of files) {
      for (const { spec } of importsOf(text)) {
        expect(spec, name).not.toMatch(
          /^node:|^@nestjs|^drizzle|^pg($|-)|^@salesforce\/(server|db|sankhya|ui|web)/,
        );
      }
      expect(stripComments(text), name).not.toMatch(/\bprocess\.|\bBuffer\b|__dirname|\brequire\(/);
    }
  });

  it('domain is a value import in exactly one place (the configuration consistency rule); elsewhere types only', () => {
    const valueImports = files.flatMap(({ name, text }) =>
      importsOf(text)
        .filter((i) => i.spec === '@salesforce/domain' && !i.typeOnly)
        .map(() => name),
    );
    expect(valueImports).toEqual(['configuration.ts']);
    expect(files.find((f) => f.name === 'configuration.ts')?.text).toMatch(
      /import \{ validateConfigurationConsistency \} from '@salesforce\/domain'/,
    );
  });

  it('the runtime schema entry does not pull in the client or openapi-fetch', () => {
    const index = files.find((f) => f.name === 'index.ts')?.text ?? '';
    expect(stripComments(index)).not.toMatch(/client/);
    for (const { name, text } of files) {
      if (name === 'client.ts') continue;
      expect(text, name).not.toMatch(/openapi-fetch/);
    }
  });

  it('contains no ERP field names or customer-specific commercial literals', () => {
    const forbidden =
      /\b(TGF[A-Z]*|CODEMP|CODTAB|CODTIPVENDA|USOPROD|NUNOTA|VLRNOTA|VLRDESC|AD_VDYORIG|AD_NUVIDYA|1001|1101)\b/;
    for (const { name, text } of files) expect(text, name).not.toMatch(forbidden);
  });
});
