// Sankhya user -> seller probe. SPIKE ONLY, READ-ONLY, NOT application code. Sandbox/TEST only.
//   node .claude/work/sankhya-user-probe.mjs [codusu]        (codusu: evidence user, default 7)
//
// Credentials: asked ONLY at hidden prompts (never arguments, files, env or history): OAuth client id, client secret, X-Token.
// Output: structure, counts and value DISTRIBUTIONS of status-like columns. Never prints names, e-mails, passwords, hashes,
// tokens or any column that looks like a secret (INTERNO, SENHA, hash, token, ACCOUNT*). Only single SELECTs are sent.
// Flow = validated (spike F-01..F-04): POST {base}/authenticate, then DbExplorerSP.executeQuery with Bearer.

const BASE = 'https://placfestas-teste.sankhyacloud.com.br';
if (new URL(BASE).host !== 'placfestas-teste.sankhyacloud.com.br') process.exit(2); // Sandbox only (SNK-3)

function hidden(prompt) {
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
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const clientId = await hidden('Sandbox OAuth client id (hidden): ');
const clientSecret = await hidden('Sandbox OAuth client secret (hidden): ');
const xToken = await hidden('Sandbox X-Token (hidden): ');

const authRes = await fetch(`${BASE}/authenticate`, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'x-token': xToken },
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
  signal: AbortSignal.timeout(20_000),
});
if (authRes.status !== 200) { console.error(`authenticate failed: HTTP ${authRes.status}`); process.exit(1); }
const accessToken = (await authRes.json()).access_token;
if (typeof accessToken !== 'string') { console.error('authenticate: no access_token'); process.exit(1); }

const SECRETISH = /SENHA|PASS|PWD|INTERNO|HASH|TOKEN|ACCOUNT|SECRET|CHAVE|KEY|EMAIL|MAIL|NOME|FONE|CELULAR|CPF|CGC|FOTO|IMAGEM|ASSINATURA/i;

function guard(sql) {
  const s = sql.trim().replace(/;+\s*$/, '');
  if (/--|\/\*|\*\//.test(s) || /;/.test(s) || !/^select\s/i.test(s) || /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|begin|execute|call)\b/i.test(s)) {
    console.error('refused: only one plain SELECT'); process.exit(2);
  }
  return s;
}
async function query(sql) {
  const res = await fetch(`${BASE}/gateway/v1/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ serviceName: 'DbExplorerSP.executeQuery', requestBody: { sql: guard(sql) } }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = await res.json().catch(() => null);
  if (res.status !== 200 || !json || String(json.status) !== '1') {
    return { error: `HTTP ${res.status} ${String(json?.statusMessage ?? '').slice(0, 200)}`, names: [], rows: [] };
  }
  return { names: (json.responseBody?.fieldsMetadata ?? []).map((f) => f.name), rows: json.responseBody?.rows ?? [] };
}
const show = (rows) => rows.slice(0, 40).forEach((r) => console.log('  ' + r.map((c) => (c === null ? 'NULL' : String(c).slice(0, 40))).join(' | ')));
const section = (t) => console.log(`\n# ${t}`);

section('A. TSIUSU columns (physical dictionary): name | type | length');
const cols = await query("SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'TSIUSU' ORDER BY COLUMN_NAME");
if (cols.error) { console.log('  ' + cols.error); process.exit(1); }
show(cols.rows);
const allCols = cols.rows.map((r) => ({ name: String(r[0]), type: String(r[1]) }));

section('B. row counts');
const total = await query('SELECT COUNT(*) FROM TSIUSU');
console.log('  TSIUSU rows:', total.rows[0]?.[0]);

section('C. value distribution of status-like columns (no names/emails/secrets)');
const interesting = allCols.filter((c) => /ATIV|BLOQ|LIM|SITU|STATUS|ADMIN|SUPER|CODGRU|GRUPO|TIPO|PERFIL|EXPIR|INATIV|DESAT|DTLIM|DTCAD|DTALTER|CODVEND|CODEMP|CODPARC|CODFUNC|SINCRO|ID/i.test(c.name) && !SECRETISH.test(c.name));
for (const c of interesting) {
  if (/DATE|TIMESTAMP/i.test(c.type)) {
    const r = await query(`SELECT COUNT(${c.name}), MIN(${c.name}), MAX(${c.name}) FROM TSIUSU`);
    console.log(`  ${c.name} (${c.type}) count/min/max:`, r.error ?? r.rows[0]?.join(' | '));
  } else {
    const r = await query(`SELECT ${c.name}, COUNT(*) FROM TSIUSU GROUP BY ${c.name} ORDER BY COUNT(*) DESC FETCH FIRST 12 ROWS ONLY`);
    console.log(`  ${c.name} (${c.type}):`, r.error ?? r.rows.map((x) => `${x[0] === null ? 'NULL' : x[0]}=${x[1]}`).join(', '));
  }
}

section('D. user -> seller relation quality');
const q = async (label, sql) => { const r = await query(sql); console.log(`  ${label}:`, r.error ?? r.rows[0]?.join(' | ')); };
await q('users with CODVEND not null and > 0', 'SELECT COUNT(*) FROM TSIUSU WHERE CODVEND IS NOT NULL AND CODVEND > 0');
await q('users with CODVEND not null/0 but no TGFVEN row (orphans)', 'SELECT COUNT(*) FROM TSIUSU U WHERE U.CODVEND IS NOT NULL AND U.CODVEND > 0 AND NOT EXISTS (SELECT 1 FROM TGFVEN V WHERE V.CODVEND = U.CODVEND)');
await q("users linked to an INACTIVE seller (TGFVEN.ATIVO='N')", "SELECT COUNT(*) FROM TSIUSU U WHERE EXISTS (SELECT 1 FROM TGFVEN V WHERE V.CODVEND = U.CODVEND AND V.ATIVO = 'N')");
await q('sellers shared by more than one user', 'SELECT COUNT(*) FROM (SELECT CODVEND FROM TSIUSU WHERE CODVEND IS NOT NULL AND CODVEND > 0 GROUP BY CODVEND HAVING COUNT(*) > 1)');
await q('CODUSU unique? (rows | distinct)', 'SELECT COUNT(*), COUNT(DISTINCT CODUSU) FROM TSIUSU');

const evidence = Number(process.argv[2] ?? '7');
if (!Number.isInteger(evidence) || evidence <= 0) process.exit(2);
section(`E. evidence user CODUSU=${evidence} (codes and flags only)`);
const flagCols = interesting.map((c) => c.name).filter((n) => n !== 'CODUSU');
const ev = await query(`SELECT CODUSU, ${flagCols.length ? flagCols.join(', ') : 'CODVEND'} FROM TSIUSU WHERE CODUSU = ${evidence}`);
console.log('  columns:', ev.error ?? ev.names.join(' | '));
show(ev.rows);
const sv = await query(`SELECT V.CODVEND, V.ATIVO FROM TSIUSU U JOIN TGFVEN V ON V.CODVEND = U.CODVEND WHERE U.CODUSU = ${evidence}`);
console.log('  linked TGFVEN (CODVEND | ATIVO):', sv.error ?? sv.rows.map((r) => r.join(' | ')).join(' ; '));
const pc = await query(`SELECT COUNT(*) FROM TGFPAR WHERE CODVEND = (SELECT CODVEND FROM TSIUSU WHERE CODUSU = ${evidence}) AND CODVEND > 0`);
console.log('  partners in portfolio (TGFPAR.CODVEND = seller):', pc.error ?? pc.rows[0]?.[0]);
console.log('\nDone. Nothing was written; nothing was stored.');
