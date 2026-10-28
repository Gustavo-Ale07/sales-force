// SANDBOX-ONLY, READ-ONLY proof that decoded Sankhya login `idusu` == TSIUSU.CODUSU. SPIKE, NOT application code.
//   node .claude/work/sankhya-idusu-proof.mjs
// Two Sandbox origins, as in staging: the tenant host (human MobileLoginSP.login, = VERIFIER_SANKHYA_BASE_URL) and the OAuth/gateway
// API origin (/authenticate + /gateway/v1, = the worker's SANKHYA_BASE_URL; default is the Sandbox API base of docs/sankhya-spike.md §9.1;
// override with the SAME env var the worker uses). Any other host, including the production api.sankhya.com.br, exits. Secrets only at hidden prompts (never args, files, env or history).
// Method: for each test user, (1) real human login (MobileLoginSP.login, same call as the verifier) -> decode idusu exactly like
// the verifier; (2) logout; (3) with the technical OAuth credentials read TSIUSU WHERE CODUSU = <decoded idusu> and compare that
// row's own login column with the login that just authenticated. A match proves the id belongs to that very user (validation
// evidence only; the app never matches by name). Then CODVEND and TGFVEN.ATIVO of that CODUSU are read.
// Output: codes and YES/NO only. Never passwords, tokens, jsessionid, names or e-mails. Only single SELECTs are sent.

const BASE = 'https://placfestas-teste.sankhyacloud.com.br';
if (new URL(BASE).host !== 'placfestas-teste.sankhyacloud.com.br') process.exit(2);
const API_BASE = (process.env.SANKHYA_BASE_URL?.trim() || 'https://api.sandbox.sankhya.com.br').replace(/\/+$/, '');
const API_HOST = new URL(API_BASE).host.toLowerCase();
if (new URL(API_BASE).protocol !== 'https:' || ![ 'api.sandbox.sankhya.com.br', 'placfestas-teste.sankhyacloud.com.br' ].includes(API_HOST)) { console.error('API origin is not an allowed Sandbox host'); process.exit(2); }
console.log('oauth/gateway origin host: ' + API_HOST);

function ask(prompt, { secret }) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) { console.error('needs an interactive terminal'); process.exit(2); }
    process.stderr.write(prompt);
    let value = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stderr.write('\n'); resolve(value); return; }
        if (ch === '\u0003' || ch === '\u0004') { stdin.setRawMode(false); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') { if (value.length > 0) { value = value.slice(0, -1); if (!secret) process.stderr.write('\b \b'); } }
        else if (ch >= ' ') { value += ch; if (!secret) process.stderr.write(ch); }
      }
    };
    stdin.on('data', onData);
  });
}

// --- same decoding as apps/server/src/verifier/sankhya-login.ts (strict Base64 of a decimal code) ---
function decodeIdusu(value) {
  const raw = value && typeof value === 'object' ? value.$ : value;
  if (typeof raw !== 'string') return null;
  const n = raw.replace(/[ \t\r\n]/g, '');
  if (n.length === 0 || n.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(n)) return null;
  const buf = Buffer.from(n, 'base64');
  if (buf.toString('base64') !== n) return null;
  const t = buf.toString('utf8');
  return /^[0-9]{1,18}$/.test(t) ? t : null;
}
const scalar = (v) => (v && typeof v === 'object' ? v.$ : v);

async function humanLogin(login, password) {
  const res = await fetch(`${BASE}/mge/service.sbr?serviceName=MobileLoginSP.login&outputType=json`, {
    method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ serviceName: 'MobileLoginSP.login', requestBody: { NOMUSU: { $: login }, INTERNO: { $: password }, KEEPCONNECTED: { $: 'N' } } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status !== 200) return { error: `HTTP ${res.status}` };
  const j = await res.json().catch(() => null);
  const session = scalar(j?.responseBody?.jsessionid);
  if (!session || session === 'undefined') return { error: `login rejected (status ${String(j?.status)})` };
  const idusu = decodeIdusu(j?.responseBody?.idusu);
  await fetch(`${BASE}/mge/service.sbr?serviceName=MobileLoginSP.logout&outputType=json&mgeSession=${encodeURIComponent(session)}`, {
    method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', cookie: `JSESSIONID=${session}` },
    body: JSON.stringify({ serviceName: 'MobileLoginSP.logout', requestBody: {} }), signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined);
  return idusu === null ? { error: 'idusu missing or not decodable' } : { idusu };
}

const clientId = await ask('Sandbox OAuth client id (hidden): ', { secret: true });
const clientSecret = await ask('Sandbox OAuth client secret (hidden): ', { secret: true });
const xToken = await ask('Sandbox X-Token (hidden): ', { secret: true });
const authRes = await fetch(`${API_BASE}/authenticate`, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'x-token': xToken },
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
  signal: AbortSignal.timeout(20_000),
});
if (authRes.status !== 200) { console.error(`authenticate failed: HTTP ${authRes.status} (host ${API_HOST}; set SANKHYA_BASE_URL to the worker value)`); process.exit(1); }
const accessToken = (await authRes.json()).access_token;
if (typeof accessToken !== 'string') { console.error('authenticate: no access_token'); process.exit(1); }

function guard(sql) {
  const s = sql.trim().replace(/;+\s*$/, '');
  if (/--|\/\*|\*\//.test(s) || /;/.test(s) || !/^select\s/i.test(s)) { console.error('refused: only one plain SELECT'); process.exit(2); }
  return s;
}
async function query(sql) {
  const res = await fetch(`${API_BASE}/gateway/v1/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ serviceName: 'DbExplorerSP.executeQuery', requestBody: { sql: guard(sql) } }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = await res.json().catch(() => null);
  if (res.status !== 200 || !json || String(json.status) !== '1') return { error: `HTTP ${res.status}`, rows: [] };
  return { rows: json.responseBody?.rows ?? [] };
}

// Login column of TSIUSU, resolved from the physical dictionary (never assumed).
const cols = await query("SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'TSIUSU' AND COLUMN_NAME IN ('NOMEUSU','NOMUSU')");
const loginCol = cols.rows.map((r) => String(r[0])).find((n) => n === 'NOMEUSU') ?? cols.rows.map((r) => String(r[0]))[0];
if (!loginCol) { console.error('TSIUSU login column not found; cannot prove'); process.exit(1); }

const results = [];
for (const label of ['A', 'B']) {
  const login = (await ask(`user ${label} login name (typed visibly, not a secret; empty = skip): `, { secret: false })).trim();
  if (login === '') { results.push({ label, skipped: true }); continue; }
  if (!/^[A-Za-z0-9._@-]{1,60}$/.test(login)) { console.error('login has unexpected characters; refused'); process.exit(2); }
  const password = await ask(`user ${label} password (hidden): `, { secret: true });
  const who = await humanLogin(login, password);
  if (who.error) { results.push({ label, error: who.error }); continue; }
  const row = await query(`SELECT U.CODUSU, UPPER(U.${loginCol}), U.CODVEND FROM TSIUSU U WHERE U.CODUSU = ${Number(who.idusu)}`);
  if (row.error || row.rows.length !== 1) { results.push({ label, error: row.error ?? `no single TSIUSU row for idusu ${who.idusu}` }); continue; }
  const [codusu, nameUp, codvend] = row.rows[0];
  const match = String(codusu) === who.idusu && String(nameUp).trim() === login.toUpperCase();
  let active = 'n/a';
  if (codvend !== null && Number(codvend) > 0) {
    const v = await query(`SELECT ATIVO FROM TGFVEN WHERE CODVEND = ${Number(codvend)}`);
    active = v.rows.length === 1 ? (String(v.rows[0][0]) === 'S' ? 'YES' : 'NO') : 'NO (no TGFVEN row)';
  }
  const shared = codvend !== null && Number(codvend) > 0
    ? (await query(`SELECT COUNT(*) FROM TSIUSU WHERE CODVEND = ${Number(codvend)}`)).rows[0]?.[0] : null;
  results.push({ label, idusu: who.idusu, codusu: String(codusu), match, hasVend: codvend !== null && Number(codvend) > 0, codvend, active, shared });
}

console.log('\n==== RESULT (codes and YES/NO only) ====');
for (const r of results) {
  console.log(`\nuser ${r.label}:`);
  if (r.skipped) { console.log('  skipped'); continue; }
  if (r.error) { console.log(`  FAILED: ${r.error}`); continue; }
  console.log(`  decoded idusu: ${r.idusu}   TSIUSU.CODUSU: ${r.codusu}`);
  console.log(`  idusu -> CODUSU match (TSIUSU row of that CODUSU carries the login that authenticated): ${r.match ? 'YES' : 'NO'}`);
  console.log(`  has CODVEND: ${r.hasVend ? 'YES' : 'NO'}${r.hasVend ? `  (CODVEND ${r.codvend})` : ''}`);
  console.log(`  seller active (TGFVEN.ATIVO='S'): ${r.active}`);
  if (r.hasVend) console.log(`  users sharing this CODVEND: ${r.shared}${Number(r.shared) > 1 ? '  -> seller_ambiguous expected' : ''}`);
}
const ok = results.filter((r) => !r.skipped);
console.log(`\nOVERALL: ${ok.length >= 2 && ok.every((r) => r.match) ? 'PROOF OK (2+ users, all match)' : 'NOT PROVEN - do NOT enable auto-provision'}`);
