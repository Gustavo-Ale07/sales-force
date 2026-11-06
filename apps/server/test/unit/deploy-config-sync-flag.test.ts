import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DEPLOY = fileURLToPath(new URL('../../../../deploy', import.meta.url));

function deployFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : deployFiles(path);
    return /\.(ya?ml|env|example|sh)$/.test(name) || name.startsWith('Dockerfile') ? [path] : [];
  });
}

describe('CONFIG_SYNC_FROM_SANKHYA in the deploy files (D-AC C3)', () => {
  it('reaches the staging worker, defaulting to off', () => {
    const compose = readFileSync(join(DEPLOY, 'docker-compose.staging.yml'), 'utf8');
    const worker = compose.slice(compose.indexOf('\n  worker:'));
    expect(worker).toContain('CONFIG_SYNC_FROM_SANKHYA: ${CONFIG_SYNC_FROM_SANKHYA:-0}');
  });

  it('is never hardcoded to on in any deploy file', () => {
    for (const file of deployFiles(DEPLOY)) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (line.trimStart().startsWith('#')) return;
        const match = /CONFIG_SYNC_FROM_SANKHYA\s*[:=]\s*["']?(\S+?)["']?\s*$/.exec(line);
        if (!match) return;
        const value = match[1] ?? '';
        const allowed = value === '0' || value === 'false' || value.startsWith('${CONFIG_SYNC_FROM_SANKHYA:-0}');
        expect(allowed, `${file}:${index + 1} sets CONFIG_SYNC_FROM_SANKHYA to "${value}"`).toBe(true);
      });
    }
  });
});
