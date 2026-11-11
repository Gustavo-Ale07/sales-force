#!/usr/bin/env node
// Publishes an Android build to the downloads center (stage B). Local, offline, no network, no secrets.
//
//   node scripts/publish-android.mjs --apk <file.apk> --version-name 0.1.0 --version-code 12 \
//        --channel staging --out <downloads-dir> [--min-version-code 10] [--label "Force (Android)"] [--notes "..."]
//
// What it does: copies the APK to <out>/force-<channel>-<versionCode>.apk, computes SHA-256 and size, merges the entry
// into <out>/downloads.json (what the /downloads page lists) and rewrites <out>/latest-<channel>.json (what the app
// updater reads: versionCode, minVersionCode, file, sha256, size). JSON files are written atomically (tmp + rename).
// It refuses to overwrite an existing APK whose content differs (a published versionCode is immutable).
// <out> is the directory the web edge serves under /downloads-files/ (see docs/downloads-center.md).
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CHANNEL = /^[a-z][a-z0-9-]{0,20}$/;
const KEEP = 5;

export function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolveHash(hash.digest("hex")));
  });
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith("--") || argv[i + 1] === undefined) throw new Error(`argumento invalido: ${key ?? ""}`);
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

export function validate(args) {
  const errors = [];
  if (!args.apk || !args.apk.toLowerCase().endsWith(".apk")) errors.push("--apk deve apontar para um arquivo .apk");
  if (!args.out) errors.push("--out e obrigatorio");
  if (!args.channel || !CHANNEL.test(args.channel)) errors.push("--channel invalido (ex.: staging, production)");
  if (!args["version-name"] || args["version-name"].length > 30) errors.push("--version-name e obrigatorio (ate 30 caracteres)");
  const code = Number(args["version-code"]);
  if (!Number.isSafeInteger(code) || code <= 0) errors.push("--version-code deve ser inteiro positivo");
  const min = args["min-version-code"] === undefined ? 1 : Number(args["min-version-code"]);
  if (!Number.isSafeInteger(min) || min <= 0) errors.push("--min-version-code deve ser inteiro positivo");
  else if (Number.isSafeInteger(code) && min > code) errors.push("--min-version-code nao pode ser maior que --version-code");
  return errors;
}

/** Pure merge: replaces the same id+versionCode, keeps the newest KEEP entries, newest first. */
export function mergeIndex(index, entry) {
  const items = Array.isArray(index?.items) ? index.items : [];
  const rest = items.filter((i) => !(i && i.id === entry.id && i.versionCode === entry.versionCode));
  return { items: [entry, ...rest].sort((a, b) => b.versionCode - a.versionCode).slice(0, KEEP) };
}

function writeJsonAtomic(path, value) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

export async function publish(args, now = new Date()) {
  const errors = validate(args);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  const apk = resolve(args.apk);
  if (!existsSync(apk)) throw new Error(`APK nao encontrado: ${basename(apk)}`);
  const out = resolve(args.out);
  mkdirSync(out, { recursive: true });
  const versionCode = Number(args["version-code"]);
  const file = `force-${args.channel}-${versionCode}.apk`;
  const target = join(out, file);
  const sha256 = await sha256File(apk);
  if (existsSync(target) && (await sha256File(target)) !== sha256) {
    throw new Error(`${file} ja foi publicado com conteudo diferente; incremente --version-code`);
  }
  if (!existsSync(target)) copyFileSync(apk, target);
  const entry = {
    id: `android-${args.channel}`,
    platform: "android",
    channel: args.channel,
    label: args.label ?? "Force (Android)",
    versionName: args["version-name"],
    versionCode,
    minVersionCode: args["min-version-code"] === undefined ? 1 : Number(args["min-version-code"]),
    file,
    sha256,
    sizeBytes: statSync(target).size,
    publishedAt: now.toISOString(),
    ...(args.notes ? { notes: args.notes } : {}),
  };
  const indexPath = join(out, "downloads.json");
  let current = { items: [] };
  if (existsSync(indexPath)) {
    try {
      current = JSON.parse(readFileSync(indexPath, "utf8"));
    } catch {
      throw new Error("downloads.json existente esta corrompido; corrija ou remova antes de publicar");
    }
  }
  writeJsonAtomic(indexPath, mergeIndex(current, entry));
  writeJsonAtomic(join(out, `latest-${args.channel}.json`), {
    channel: entry.channel,
    versionName: entry.versionName,
    versionCode: entry.versionCode,
    minVersionCode: entry.minVersionCode,
    file: entry.file,
    sha256: entry.sha256,
    sizeBytes: entry.sizeBytes,
    publishedAt: entry.publishedAt,
  });
  return entry;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  publish(parseArgs(process.argv.slice(2)))
    .then((entry) => console.log(`publicado ${entry.file} (${entry.sizeBytes} bytes, sha256 ${entry.sha256})`))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
