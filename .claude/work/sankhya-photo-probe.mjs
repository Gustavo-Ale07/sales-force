// Sankhya product-photo source probe. SPIKE ONLY, READ-ONLY, NOT application code. NOT RUN by its author.
// Run by the OWNER, against the Sandbox/TEST environment only, from the worker host (credentials live there):
//   node .claude/work/sankhya-photo-probe.mjs dict            # step C: columns of TGFPRO from TDDCAM (+ discovery of TDDCAM's own columns)
//   node .claude/work/sankhya-photo-probe.mjs dict-attach     # step D: dictionary tables/columns that look like attachments
//   node .claude/work/sankhya-photo-probe.mjs candidates IMAGEM   # step B/E: counts + up to 5 CODPROD whose column <COL> is non-empty
//   node .claude/work/sankhya-photo-probe.mjs sql "SELECT ..."    # one custom SELECT (guarded)
//
// Credentials: read ONLY from the environment at runtime (same names as packages/sankhya):
//   SANKHYA_BASE_URL, SANKHYA_CLIENT_ID, SANKHYA_CLIENT_SECRET, SANKHYA_X_TOKEN, SANKHYA_ALLOWED_HOSTS
// Never prints credentials, tokens, binary or base64: every cell is truncated; cells of 200+ chars or that
// look like base64/hex payloads are replaced by "<N chars suppressed>". Only SELECT statements are accepted.
// Flow = the validated one (spike F-01..F-04): POST {base}/authenticate (client_credentials + X-Token), then
// POST {base}/gateway/v1/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json with Bearer.
// Every table/column named below besides TGFPRO/TGFGRU/TDDCAM.NUCAMPO is an UNVALIDATED HYPOTHESIS to test.

const env = (name) => {
  const v = process.env[name];
  if (!v) { console.error(`Missing env ${name}`); process.exit(2); }
  return v;
};

const base = env('SANKHYA_BASE_URL').replace(/\/+$/, '');
const allowed = env('SANKHYA_ALLOWED_HOSTS').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
const host = new URL(base).host.toLowerCase();
if (!allowed.includes(host)) { console.error(`Host ${host} is not in SANKHYA_ALLOWED_HOSTS`); process.exit(2); }
if (new URL(base).protocol !== 'https:') { console.error('HTTPS required'); process.exit(2); }
if (/producao|production|prod\b/i.test(process.env.SANKHYA_ENVIRONMENT ?? '')) {
  console.error('Refusing: SANKHYA_ENVIRONMENT looks like production (SNK-3). Use the Sandbox/TEST environment.');
  process.exit(2);
}
console.error(`Target host: ${host} (read-only SELECTs)`);

async function token() {
  const res = await fetch(`${base}/authenticate`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'x-token': env('SANKHYA_X_TOKEN') },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env('SANKHYA_CLIENT_ID'), client_secret: env('SANKHYA_CLIENT_SECRET') }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status !== 200) { console.error(`authenticate failed: HTTP ${res.status}`); process.exit(1); }
  const json = await res.json();
  if (typeof json.access_token !== 'string') { console.error('authenticate: no access_token field'); process.exit(1); }
  return json.access_token;
}

function guard(sql) {
  const s = sql.trim().replace(/;+\s*$/, '');
  if (/--|\/\*|\*\//.test(s)) { console.error('SQL comments are refused.'); process.exit(2); }
  if (!/^select\s/i.test(s) || /;/.test(s) || /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|begin|execute|call)\b/i.test(s)) {
    console.error('Only a single plain SELECT is accepted.'); process.exit(2);
  }
  return s;
}

function show(cell) {
  if (cell === null || cell === undefined) return 'NULL';
  const t = String(cell);
  if (t.length >= 200 || /^[A-Za-z0-9+/=\s]{120,}$/.test(t)) return `<${t.length} chars suppressed>`;
  return t.length > 80 ? `${t.slice(0, 77)}...` : t;
}

async function query(tk, sql) {
  const res = await fetch(`${base}/gateway/v1/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${tk}` },
    body: JSON.stringify({ serviceName: 'DbExplorerSP.executeQuery', requestBody: { sql } }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = await res.json().catch(() => null);
  // A SQL error is HTTP 200 + status "0" (F-19). Print the ERP message only, never the request headers.
  if (res.status !== 200 || !json || String(json.status) !== '1') {
    console.log(`  -> HTTP ${res.status}, status=${json?.status}, message=${String(json?.statusMessage ?? '').slice(0, 300)}`);
    return null;
  }
  const names = (json.responseBody?.fieldsMetadata ?? []).map((f) => f.name);
  const rows = json.responseBody?.rows ?? [];
  console.log(`  columns: ${names.join(', ')}  | rows: ${rows.length}${json.responseBody?.burstLimit ? ' (burstLimit!)' : ''}`);
  for (const r of rows.slice(0, 60)) console.log('  ' + r.map(show).join(' | '));
  return { names, rows };
}

// Quiet variant: returns the rows (never printed) plus the HTTP status and the response Content-Type.
async function rawQuery(tk, sql) {
  const res = await fetch(`${base}/gateway/v1/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${tk}` },
    body: JSON.stringify({ serviceName: 'DbExplorerSP.executeQuery', requestBody: { sql } }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = await res.json().catch(() => null);
  if (res.status !== 200 || !json || String(json.status) !== '1') {
    console.error(`query failed: HTTP ${res.status}, message=${String(json?.statusMessage ?? '').slice(0, 300)}`);
    process.exit(1);
  }
  return { http: res.status, contentType: res.headers.get('content-type') ?? '', rows: json.responseBody?.rows ?? [] };
}

// The REAL product read of the sync (packages/sankhya/src/real/mapping.ts, productSpec): `CODPROD > 0`
// [AND ATIVO = 'S' unless showInactive] AND USOPROD IN (<sellableUsageValues>). Values validated like read-scope.ts.
function mirrorWhere(usageCsv, activeOnly) {
  const values = (usageCsv ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  if (values.length === 0 || !values.every((v) => /^[A-Za-z0-9]{1,5}$/.test(v))) {
    console.error('usage values: comma-separated, 1-5 alphanumeric characters each'); process.exit(2);
  }
  if (activeOnly !== 'Y' && activeOnly !== 'N') { console.error('activeOnly must be Y or N'); process.exit(2); }
  const terms = ['CODPROD > 0'];
  if (activeOnly === 'Y') terms.push("ATIVO = 'S'");
  terms.push(`USOPROD IN (${values.map((v) => `'${v}'`).join(',')})`);
  return terms.join(' AND ');
}

function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ok: buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9 };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return { mime: 'image/png', ok: buf.subarray(-8).equals(Buffer.from('49454e44ae426082', 'hex')) };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ok: buf.readUInt32LE(4) + 8 === buf.length };
  return { mime: 'unknown', ok: false };
}

const [mode, arg, arg2, arg3] = process.argv.slice(2);
const tk = await token();
const run = async (title, sql) => { console.log(`\n# ${title}\n  ${sql}`); return query(tk, guard(sql)); };

if (mode === 'dict') {
  // Only TDDCAM.NUCAMPO is proven by the repo (spike). Discover the real column names first.
  await run('TDDCAM column discovery', 'SELECT * FROM TDDCAM FETCH FIRST 1 ROWS ONLY');
  // HYPOTHESIS: the table-name column is NOMETAB (TDDCAM) - adjust after the discovery above.
  await run('TGFPRO columns (hypothesis: TDDCAM.NOMETAB)', "SELECT * FROM TDDCAM WHERE NOMETAB = 'TGFPRO' ORDER BY NUCAMPO");
  await run('TGFPRO columns present in the physical DB (Oracle dictionary, hypothesis: visible to this user)',
    "SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'TGFPRO' ORDER BY COLUMN_NAME");
} else if (mode === 'dict-attach') {
  await run('LOB columns of TGFPRO (hypothesis: Oracle dictionary)',
    "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'TGFPRO' AND DATA_TYPE IN ('BLOB','CLOB','LONG RAW','RAW','LONG')");
  await run('Tables that look like attachment stores (hypothesis, names unproven)',
    "SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME LIKE '%ANEX%' OR TABLE_NAME LIKE '%ATA%' OR TABLE_NAME LIKE '%IMAG%' OR TABLE_NAME LIKE '%FOTO%' ORDER BY TABLE_NAME");
  await run('AD_* columns of TGFPRO (hypothesis)',
    "SELECT COLUMN_NAME, DATA_TYPE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'TGFPRO' AND COLUMN_NAME LIKE 'AD\\_%' ESCAPE '\\' ORDER BY COLUMN_NAME");
} else if (mode === 'candidates') {
  const col = (arg ?? '').toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,29}$/.test(col)) { console.error('Column must be an identifier, e.g. IMAGEM'); process.exit(2); }
  // HYPOTHESIS: <col> is a BLOB on TGFPRO. Only the byte LENGTH is selected, never the content.
  await run(`TGFPRO.${col}: how many non-empty (length only)`,
    `SELECT COUNT(*) AS TOTAL, SUM(CASE WHEN ${col} IS NOT NULL AND DBMS_LOB.GETLENGTH(${col}) > 0 THEN 1 ELSE 0 END) AS COM_FOTO FROM TGFPRO WHERE CODPROD > 0`);
  await run(`TGFPRO.${col}: up to 5 CODPROD with a photo (active products first)`,
    `SELECT CODPROD, ATIVO, DBMS_LOB.GETLENGTH(${col}) AS BYTES FROM TGFPRO WHERE CODPROD > 0 AND ${col} IS NOT NULL AND DBMS_LOB.GETLENGTH(${col}) > 0 ORDER BY CASE WHEN ATIVO = 'S' THEN 0 ELSE 1 END, CODPROD FETCH FIRST 5 ROWS ONLY`);
} else if (mode === 'mirror-candidates') {
  // usage: mirror-candidates <USOPROD csv, e.g. V,R> <activeOnly Y|N>   (same filter as the sync + IMAGEM non-empty)
  const where = mirrorWhere(arg, arg2);
  await run('Sync-equivalent set: products in the set, and how many have a photo (length only)',
    `SELECT COUNT(*) AS NO_CONJUNTO, SUM(CASE WHEN IMAGEM IS NOT NULL AND DBMS_LOB.GETLENGTH(IMAGEM) > 0 THEN 1 ELSE 0 END) AS COM_FOTO FROM TGFPRO WHERE ${where}`);
  await run('Up to 5 candidates of the set with a photo',
    `SELECT CODPROD, ATIVO, USOPROD, DBMS_LOB.GETLENGTH(IMAGEM) AS BYTES FROM TGFPRO WHERE ${where} AND IMAGEM IS NOT NULL AND DBMS_LOB.GETLENGTH(IMAGEM) > 0 ORDER BY CODPROD FETCH FIRST 5 ROWS ONLY`);
} else if (mode === 'fetch-one') {
  // usage: fetch-one <CODPROD> <USOPROD csv> <activeOnly Y|N>
  // ONE product. Reads TGFPRO.IMAGEM through the proven DbExplorerSP.executeQuery in 2000-byte hex chunks
  // (SELECT only), assembles it in /tmp (0600), validates it, prints only metadata + SHA-256, deletes it.
  if (!/^[1-9][0-9]{0,9}$/.test(arg ?? '')) { console.error('CODPROD must be a positive integer'); process.exit(2); }
  const cod = Number(arg);
  const where = mirrorWhere(arg2, arg3);
  const fs = await import('node:fs');
  const crypto = await import('node:crypto');
  const meta = await rawQuery(tk, guard(`SELECT CODPROD, ATIVO, USOPROD, DBMS_LOB.GETLENGTH(IMAGEM) AS BYTES FROM TGFPRO WHERE ${where} AND CODPROD = ${cod} AND IMAGEM IS NOT NULL AND DBMS_LOB.GETLENGTH(IMAGEM) > 0`));
  if (meta.rows.length !== 1) { console.log(`CODPROD ${cod} is not a product of the sync-equivalent set with a photo. Nothing read.`); process.exit(1); }
  const expected = Number(meta.rows[0][3]);
  if (!Number.isInteger(expected) || expected <= 0 || expected > 2_000_000) { console.error(`Refusing: BLOB length ${expected} outside (0, 2,000,000]`); process.exit(1); }
  const chunks = [];
  let statuses = new Set();
  let ctype = '';
  for (let off = 1; off <= expected; off += 2000) {
    const r = await rawQuery(tk, guard(`SELECT RAWTOHEX(DBMS_LOB.SUBSTR(IMAGEM, 2000, ${off})) AS H FROM TGFPRO WHERE CODPROD = ${cod}`));
    statuses.add(r.http); ctype ||= r.contentType;
    const hex = String(r.rows[0]?.[0] ?? '');
    if (!/^([0-9A-Fa-f]{2})+$/.test(hex)) { console.error(`Chunk at offset ${off} is not hex`); process.exit(1); }
    chunks.push(Buffer.from(hex, 'hex'));
  }
  const buf = Buffer.concat(chunks);
  const file = `/tmp/sf-photo-probe-${cod}.bin`;
  try {
    fs.writeFileSync(file, buf, { mode: 0o600, flag: 'wx' });
    const kind = sniff(buf);
    console.log(`CODPROD ${cod} | transport: DbExplorerSP.executeQuery (hex chunks) | HTTP statuses: ${[...statuses].join(',')} | gateway Content-Type: ${ctype}`);
    console.log(`expected bytes (GETLENGTH): ${expected} | downloaded bytes: ${buf.length} | size match: ${buf.length === expected}`);
    console.log(`magic bytes: ${buf.subarray(0, 12).toString('hex')} | detected format: ${kind.mime} | structurally complete: ${kind.ok}`);
    console.log(`sha256: ${crypto.createHash('sha256').update(buf).digest('hex')} | non-empty: ${buf.length > 0}`);
  } finally {
    try { fs.unlinkSync(file); console.log(`temporary file ${file} removed: ${!fs.existsSync(file)}`); } catch { console.log('temporary file not created or already removed'); }
  }
} else if (mode === 'sql') {
  await run('custom SELECT', arg ?? '');
} else {
  console.error('Usage: dict | dict-attach | candidates <COLUMN> | mirror-candidates <USOPROD csv> <Y|N> | fetch-one <CODPROD> <USOPROD csv> <Y|N> | sql "<SELECT>"'); process.exit(2);
}
