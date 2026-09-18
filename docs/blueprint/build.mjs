#!/usr/bin/env node
/*
  Blueprint build — reassembles docs/blueprint.html from docs/blueprint/parts/**.

    node docs/blueprint/build.mjs           build + validation report
    node docs/blueprint/build.mjs --check   report only; exit 1 if blueprint.html is out of date
    node docs/blueprint/build.mjs --list    print the resolved part order

  Parts are verbatim fragments; the build is a plain concatenation in manifest
  order, so it is deterministic and reproducible. Never edit blueprint.html by
  hand — edit the part and rebuild. No dependencies; Node >= 18.
*/
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const partsDir = join(here, "parts");
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const outFile = join(here, manifest.output);
const args = new Set(process.argv.slice(2));

// ---- resolve manifest patterns into an ordered, sorted file list ----------
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const rel = (p) => relative(partsDir, p).split(sep).join("/");
const all = walk(partsDir).map(rel).sort();   // code-point order, "/" separators

function expand(pattern) {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -2);
    return all.filter((f) => f.startsWith(prefix));
  }
  if (pattern.includes("*")) {
    const dir = pattern.slice(0, pattern.lastIndexOf("/") + 1);
    const [pre, post] = pattern.slice(dir.length).split("*");
    return all.filter((f) => f.startsWith(dir) && !f.slice(dir.length).includes("/")
      && f.slice(dir.length).startsWith(pre) && f.endsWith(post));
  }
  if (!all.includes(pattern)) throw new Error(`manifest entry not found: ${pattern}`);
  return [pattern];
}
const order = manifest.order.flatMap(expand);
const seen = new Set();
for (const f of order) {
  if (seen.has(f)) throw new Error(`part listed twice: ${f}`);
  seen.add(f);
}
const unused = all.filter((f) => !seen.has(f));
if (unused.length) throw new Error(`parts not covered by manifest.json: ${unused.join(", ")}`);

if (args.has("--list")) { console.log(order.join("\n")); process.exit(0); }

// ---- concatenate --------------------------------------------------------
const html = Buffer.concat(order.map((f) => readFileSync(join(partsDir, f))));
const text = html.toString("utf8");

// ---- validations --------------------------------------------------------
const problems = [];
const noScript = text.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
for (const tag of ["section", "figure", "div", "main", "table", "thead", "tbody", "tr", "td", "th",
                   "ul", "ol", "li", "p", "span", "strong", "a", "button", "label", "h2", "h3",
                   "figcaption", "svg", "header", "nav"]) {
  const open = (noScript.match(new RegExp(`<${tag}[\\s>]`, "g")) || []).length;
  const close = (noScript.match(new RegExp(`</${tag}>`, "g")) || []).length;
  if (open !== close) problems.push(`unbalanced <${tag}>: ${open} open / ${close} close`);
}
for (const [o, c] of [["<style", "</style>"], ["<script", "</script>"]]) {
  const open = (text.match(new RegExp(o, "g")) || []).length;
  const close = (text.match(new RegExp(c, "g")) || []).length;
  if (open !== close) problems.push(`unbalanced ${o}: ${open}/${close}`);
}
const ids = [...noScript.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dup.length) problems.push(`duplicate id: ${[...new Set(dup)].join(", ")}`);

for (const m of text.matchAll(/<script id="([^"]+)">\n([\s\S]*?)<\/script>/g)) {
  try { new vm.Script(m[2], { filename: `script#${m[1]}` }); }
  catch (e) { problems.push(`JS syntax error in <script id="${m[1]}">: ${e.message}`); }
}

// ---- output -------------------------------------------------------------
const sha = createHash("sha256").update(html).digest("hex").slice(0, 12);
const sections = (noScript.match(/<section class="doc-section"/g) || []).length;
const screens = (text.match(/^\{ id: '[A-Z]+-\d+'/gm) || []).length;
const kb = (html.length / 1024).toFixed(0);
const tokens = Math.round(html.length / 3.2 / 1000);

let status;
if (args.has("--check")) {
  const current = existsSync(outFile) ? readFileSync(outFile) : null;
  status = current && current.equals(html) ? "up to date" : "OUT OF DATE (run the build)";
} else {
  writeFileSync(outFile, html);
  status = "written";
}

console.log(`blueprint.html: ${status} · ${order.length} parts · ${kb} KB (~${tokens}K tokens if read whole — never read it) · sha256 ${sha}`);
console.log(`sections ${sections} · screens ${screens} · ids ${ids.length} · ${problems.length ? "PROBLEMS:" : "no problems found"}`);
for (const p of problems) console.log(`  - ${p}`);
if (problems.length || status.startsWith("OUT")) process.exit(1);
