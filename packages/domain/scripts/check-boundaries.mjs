#!/usr/bin/env node
// Dependency-boundary and hygiene check for packages/domain (ARCH-1, P-05/P-06, CFG-1..6).
// Fails (exit 1) when:
//  - src imports anything except relative files inside src or an allowed pure library;
//  - src uses Node built-ins/globals or non-deterministic sources (clock, randomness);
//  - src or test contains ERP-specific names or customer-specific commercial literals.
// Usage: node scripts/check-boundaries.mjs [--dir <package-dir>]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_PACKAGES = new Set(['decimal.js']);

// Names that belong to the ERP or to one customer's data; forbidden anywhere in domain sources/tests.
const FORBIDDEN_LITERALS = [
  { name: 'ERP table/column name', re: /\b(TGF[A-Z]*|TSI[A-Z]*|CODEMP|CODTAB|CODTIPVENDA|USOPROD|NUNOTA|VLRNOTA|VLRDESC)\b/ },
  { name: 'ERP origin-id field name', re: /\bAD_(VDYORIG|NUVIDYA)\b/ },
  { name: 'customer-specific TOP code', re: /\b(1001|1101)\b/ },
  { name: 'customer-specific usage literal', re: /(['"`])[VR]\1/ },
];

// Forbidden in src only: Node globals and non-determinism.
const FORBIDDEN_IN_SRC = [
  { name: 'Node global', re: /\b(process|Buffer|__dirname|__filename|require)\b/ },
  { name: 'clock read', re: /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)/ },
  { name: 'randomness', re: /\bMath\.random\b|\bcrypto\b/ },
  { name: 'console', re: /\bconsole\./ },
];

const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry)) out.push(full);
  }
  return out;
}

function importSpecifiers(code) {
  const specs = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of code.matchAll(re)) specs.push(m[1]);
  return specs;
}

function packageName(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

export function checkSource({ file, text, srcDir, isSrc }) {
  const problems = [];
  const code = stripComments(text);

  if (isSrc) {
    for (const spec of importSpecifiers(code)) {
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec);
        const rel = relative(srcDir, target);
        if (rel.startsWith('..') || rel.split(sep)[0] === '..') {
          problems.push(`import escapes src: "${spec}"`);
        }
      } else if (builtins.has(spec) || spec.startsWith('node:')) {
        problems.push(`Node built-in import: "${spec}"`);
      } else if (!ALLOWED_PACKAGES.has(packageName(spec))) {
        problems.push(`import of non-allowed package: "${spec}"`);
      }
    }
    for (const { name, re } of FORBIDDEN_IN_SRC) {
      if (re.test(code)) problems.push(`${name} is not allowed in domain source`);
    }
  }

  // Literals are checked including comments: names must not appear anywhere.
  for (const { name, re } of FORBIDDEN_LITERALS) {
    if (re.test(text)) problems.push(`forbidden ${name}`);
  }
  return problems;
}

function main() {
  const argDir = process.argv.indexOf('--dir');
  const root =
    argDir > -1 ? resolve(process.argv[argDir + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const srcDir = join(root, 'src');
  const testDir = join(root, 'test');

  let failures = 0;
  const scan = (dir, isSrc) => {
    let files;
    try {
      files = listFiles(dir);
    } catch {
      return;
    }
    for (const file of files) {
      for (const problem of checkSource({ file, text: readFileSync(file, 'utf8'), srcDir, isSrc })) {
        failures += 1;
        console.error(`${relative(root, file)}: ${problem}`);
      }
    }
  };
  scan(srcDir, true);
  scan(testDir, false);

  if (failures > 0) {
    console.error(`domain boundary check FAILED (${failures} problem(s))`);
    process.exit(1);
  }
  console.log('domain boundary check passed');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
