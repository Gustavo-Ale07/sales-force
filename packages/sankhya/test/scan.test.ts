import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Honest guard, not proof: it catches obvious leaks (secret-looking strings, PLAC-specific
// commercial constants, the legacy origin fields) in package sources and fixtures.
// Test files are excluded from the literal scan because they name the forbidden values on purpose.

const PACKAGE_ROOT = join(import.meta.dirname, '..');

function filesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

const sourceFiles = filesUnder(join(PACKAGE_ROOT, 'src')).filter((path) => path.endsWith('.ts'));
const fixtureFiles = filesUnder(join(PACKAGE_ROOT, 'test')).filter((path) => /[\\/]fixtures[\\/]/.test(path));

/** Strips comments so a spike-referencing comment may mention a value; code and strings may not. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FORBIDDEN: readonly { name: string; pattern: RegExp }[] = [
  { name: 'AD_VDYORIG / AD_NUVIDYA (SNK-5)', pattern: /AD_VDYORIG|AD_NUVIDYA/ },
  { name: 'CODEMP = 1', pattern: /CODEMP\s*[:=]+\s*1\b/ },
  { name: 'PLAC TOP 1001 / 1101', pattern: /\b(1001|1101)\b/ },
  { name: 'CODTAB 5', pattern: /CODTAB\s*[:=]+\s*5\b/ },
  { name: 'CODTIPVENDA 1', pattern: /CODTIPVENDA\s*[:=]+\s*1\b/ },
  { name: "USOPROD 'V' / 'R'", pattern: /USOPROD[^\n]{0,20}['"][VR]['"]/ },
];

const SECRET_LOOKING: readonly { name: string; pattern: RegExp }[] = [
  { name: 'JWT', pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
  { name: 'Bearer token', pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/ },
  { name: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'long hex/base64 blob', pattern: /['"][A-Za-z0-9+/=_-]{40,}['"]/ },
];

describe('repository hygiene scan', () => {
  it('finds the files it is meant to scan', () => {
    expect(sourceFiles.length).toBeGreaterThan(10);
  });

  it('source has no PLAC-specific commercial constants or legacy origin fields outside comments', () => {
    const hits: string[] = [];
    for (const path of sourceFiles) {
      const code = withoutComments(readFileSync(path, 'utf8'));
      for (const { name, pattern } of FORBIDDEN) if (pattern.test(code)) hits.push(`${relative(PACKAGE_ROOT, path)}: ${name}`);
    }
    expect(hits).toEqual([]);
  });

  it('source and fixtures contain no secret-looking strings', () => {
    const hits: string[] = [];
    for (const path of [...sourceFiles, ...fixtureFiles]) {
      const text = readFileSync(path, 'utf8');
      for (const { name, pattern } of SECRET_LOOKING) if (pattern.test(text)) hits.push(`${relative(PACKAGE_ROOT, path)}: ${name}`);
    }
    expect(hits).toEqual([]);
  });

  it('fixtures carry provenance and no raw capture directory is referenced', () => {
    for (const path of sourceFiles) expect(readFileSync(path, 'utf8')).not.toMatch(/\.sankhya-raw/);
  });
});
