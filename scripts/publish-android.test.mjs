// Run with: node --test scripts/publish-android.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mergeIndex, publish, validate } from "./publish-android.mjs";

const base = { channel: "staging", "version-name": "0.1.0", "version-code": "12" };

function setup(content = "apk-bytes") {
  const dir = mkdtempSync(join(tmpdir(), "pub-"));
  const apk = join(dir, "in.apk");
  writeFileSync(apk, content);
  return { dir, apk, out: join(dir, "out") };
}

test("validate rejects bad channel, version code and minimum above the version", () => {
  assert.equal(validate({ ...base, apk: "a.apk", out: "o" }).length, 0);
  assert.ok(validate({ ...base, channel: "Prod/..", apk: "a.apk", out: "o" }).length > 0);
  assert.ok(validate({ ...base, "version-code": "0", apk: "a.apk", out: "o" }).length > 0);
  assert.ok(validate({ ...base, "min-version-code": "99", apk: "a.apk", out: "o" }).length > 0);
  assert.ok(validate({ ...base, apk: "a.exe", out: "o" }).length > 0);
});

test("publish writes the apk, downloads.json and latest json with the real digest", async () => {
  const { apk, out } = setup();
  const entry = await publish({ ...base, apk, out, "min-version-code": "10" }, new Date("2026-11-11T12:00:00Z"));
  assert.equal(entry.file, "force-staging-12.apk");
  assert.match(entry.sha256, /^[0-9a-f]{64}$/);
  assert.equal(entry.sizeBytes, 9);
  const index = JSON.parse(readFileSync(join(out, "downloads.json"), "utf8"));
  assert.equal(index.items[0].versionCode, 12);
  const latest = JSON.parse(readFileSync(join(out, "latest-staging.json"), "utf8"));
  assert.deepEqual([latest.versionCode, latest.minVersionCode, latest.sha256], [12, 10, entry.sha256]);
});

test("a published version code is immutable but republishing identical bytes is fine", async () => {
  const first = setup("one");
  await publish({ ...base, apk: first.apk, out: first.out });
  await publish({ ...base, apk: first.apk, out: first.out });
  const other = setup("two");
  await assert.rejects(publish({ ...base, apk: other.apk, out: first.out }), /conteudo diferente/);
});

test("mergeIndex replaces the same version, sorts newest first and keeps five", () => {
  let index = { items: [] };
  for (let code = 1; code <= 7; code += 1) index = mergeIndex(index, { id: "android-staging", versionCode: code });
  assert.deepEqual(index.items.map((i) => i.versionCode), [7, 6, 5, 4, 3]);
  index = mergeIndex(index, { id: "android-staging", versionCode: 7, marker: true });
  assert.equal(index.items.length, 5);
  assert.equal(index.items[0].marker, true);
});
