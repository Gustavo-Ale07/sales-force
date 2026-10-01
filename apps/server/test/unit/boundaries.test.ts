import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const serverRoot = fileURLToPath(new URL('../..', import.meta.url));
const repoRoot = join(serverRoot, '..', '..');

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (path.endsWith('.ts')) files.push(path);
  }
  return files;
}

const srcFiles = sourceFiles(join(serverRoot, 'src'));
const posix = (path: string) => relative(serverRoot, path).split(sep).join('/');

describe('process boundaries (STACK-2, STACK-3)', () => {
  it('reads Sankhya settings and builds the gateway only in worker code (and the dev seed)', () => {
    const allowed = ['src/config/worker-env.ts', 'src/config/api-env.ts', 'src/seed.ts', 'src/config/seed-env.ts'];
    const offenders = srcFiles
      .filter((file) => /SANKHYA_|SF_CONFIG_FILE|createGateway/.test(readFileSync(file, 'utf8')))
      .map(posix)
      .filter((file) => !allowed.includes(file));
    expect(offenders).toEqual([]);
  });

  it('keeps the API environment schema free of Sankhya variables', () => {
    const apiEnv = readFileSync(join(serverRoot, 'src/config/api-env.ts'), 'utf8');
    // Mentions in comments are allowed; there must be no schema key and no gateway.
    expect(apiEnv).not.toMatch(/^\s+SANKHYA_\w+\s*:/m);
    expect(apiEnv).not.toMatch(/createGateway/);
  });

  it('keeps pg-boss and the gateway out of the API modules', () => {
    const apiSide = srcFiles.map(posix).filter((file) => file.startsWith('src/api/') || file.startsWith('src/http/'));
    for (const file of apiSide) {
      const text = readFileSync(join(serverRoot, file), 'utf8');
      expect(text, file).not.toMatch(/from 'pg-boss'/);
      expect(text, file).not.toMatch(/createGateway|SankhyaGateway/);
    }
  });

  it('does not use console (structured logging only)', () => {
    for (const file of srcFiles) expect(readFileSync(file, 'utf8'), posix(file)).not.toMatch(/\bconsole\./);
  });
});

describe('no customer-specific literals in code (PROD-1)', () => {
  it('finds no installation name in apps/server or packages source', () => {
    const roots = [join(serverRoot, 'src'), join(repoRoot, 'packages')];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const rel = relative(repoRoot, file).split(sep).join('/');
        // Existing synthetic demo/test data is outside this check.
        if (/\/(tests?|fixtures?)\//.test(rel) || rel.includes('demo-')) continue;
        if (/\bplac\b/i.test(readFileSync(file, 'utf8'))) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
