#!/usr/bin/env node
// Unico caminho para publicar OTA do staging (STAGING_BUILD.md, "OTA"). Nunca rode `eas update` solto.
// Define as variaveis do build staging, exporta o bundle com cache limpo, FALHA se o bundle nao contiver a URL da API
// e so entao publica. Uso: node scripts/publish-ota-staging.mjs "<mensagem do update>"
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URL = 'https://force.sistemasplac.com.br';
const env = {
  ...process.env,
  APP_VARIANT: 'staging',
  SF_BUILD_PROFILE: 'staging',
  EXPO_PUBLIC_BUILD_PROFILE: 'staging',
  EXPO_PUBLIC_API_URL: API_URL,
  EXPO_UPDATES_URL: 'https://u.expo.dev/1c87d85a-9a13-4e9a-8b95-43dda00748c5',
};
const message = process.argv[2];
if (message === undefined || message.trim() === '') {
  console.error('Informe a mensagem do update: node scripts/publish-ota-staging.mjs "<o que mudou>"');
  process.exit(2);
}

function run(args) {
  // No Windows o npx exige shell: argumentos com espaco precisam de aspas, senao a mensagem vira varios argumentos.
  const win = process.platform === 'win32';
  const argv = win ? args.map((a) => (/[\s()+&|<>^]/.test(a) ? `"${a.replace(/"/g, '')}"` : a)) : args;
  const result = spawnSync('npx', argv, { env, stdio: 'inherit', shell: win, cwd: join(dirname(fileURLToPath(import.meta.url)), '..') });
  if (result.status !== 0) {
    console.error(`Falhou: npx ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

const out = mkdtempSync(join(tmpdir(), 'sf-ota-check-'));
run(['expo', 'export', '--platform', 'android', '--output-dir', out, '--clear']);

const bundles = [...files(out)].filter((f) => /\.(hbc|js)$/.test(f) && f.includes('android'));
if (bundles.length === 0) {
  console.error('Nenhum bundle android exportado: nada foi publicado.');
  process.exit(1);
}
const hasUrl = bundles.some((f) => readFileSync(f).includes('force.sistemasplac.com.br'));
if (!hasUrl) {
  console.error('O bundle exportado NAO contem force.sistemasplac.com.br (variaveis nao inlinadas): nada foi publicado.');
  process.exit(1);
}
console.log('Bundle conferido: contem force.sistemasplac.com.br.');

run(['eas-cli', 'update', '--branch', 'staging', '--clear-cache', '--message', message, '--environment', 'preview', '--non-interactive']);
