// Sankhya TEST end-user login probe (MobileLoginSP.login). Spike only; NOT application code.
// Reads username + password from the TTY (password not echoed) or, when stdin is piped, from two lines.
// Prints ONLY: AUTH_SANKHYA_USER, HTTP status, functional status, jsessionId received YES/NO, logout outcome.
// Never prints/stores the password, the request/response body or the session id. No redirects followed.
import readline from 'node:readline';

const ALLOWED_HOST = 'placfestas-teste.sankhyacloud.com.br';
const SELFTEST = process.env.PROBE_SELFTEST_URL; // only accepted for http://127.0.0.1:<port> (mock, no network)
const base = SELFTEST && /^http:\/\/127\.0\.0\.1:\d+$/.test(SELFTEST) ? SELFTEST : `https://${ALLOWED_HOST}`;

function readLines(n) {
  return new Promise((resolve) => {
    const lines = [];
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (l) => { lines.push(l); if (lines.length === n) rl.close(); });
    rl.on('close', () => resolve(lines));
  });
}

function askHidden(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let value = '';
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); return resolve(value); }
        if (c === '\u0003') { stdin.setRawMode(false); process.exit(130); }
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1); else value += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function post(path, body, cookie) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = `JSESSIONID=${cookie}`;
  const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  let json = null;
  try { json = JSON.parse(await res.text()); } catch { /* non-JSON: reported as such */ }
  return { http: res.status, json };
}

let username; let password;
if (process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  username = await new Promise((r) => rl.question('Usuario Sankhya (TESTE): ', r)); rl.close();
  password = await askHidden('Senha (nao exibida): ');
} else {
  [username, password] = await readLines(2);
}
username = (username ?? '').trim();
if (!username || !password) { console.log('AUTH_SANKHYA_USER = FAIL\nmotivo: usuario/senha nao informados'); process.exit(2); }

let out = { result: 'FAIL', http: 'n/a', functional: 'n/a', session: 'NO', logout: 'n/a', message: 'n/a', errCode: 'n/a', errLevel: 'n/a' };
// Diagnostic fields only (statusMessage, tsError code/level). Sanitized: secrets never echoed, length-capped, single line.
function clean(v, secrets) {
  if (v === undefined || v === null) return 'n/a';
  let t = String(v).replace(/\s+/g, ' ');
  for (const x of secrets) if (x && x.length >= 3) t = t.split(x).join('[redacted]');
  return t.length > 200 ? t.slice(0, 200) + '...' : t;
}
let sessionId = null;
try {
  const body = { serviceName: 'MobileLoginSP.login', requestBody: { NOMUSU: { $: username }, INTERNO: { $: password }, KEEPCONNECTED: { $: 'N' } } };
  const r = await post('/mge/service.sbr?serviceName=MobileLoginSP.login&outputType=json', body);
  out.http = r.http;
  out.functional = r.json === null ? 'resposta nao-JSON' : `status=${r.json.status ?? '?'}`;
  const secrets = [password, username];
  out.message = clean(r.json?.statusMessage, secrets);
  out.errCode = clean(r.json?.tsError?.tsErrorCode, secrets);
  out.errLevel = clean(r.json?.tsError?.tsErrorLevel, secrets);
  const sid = r.json?.responseBody?.jsessionid?.$;
  if (typeof sid === 'string' && sid.length > 0 && sid !== 'undefined') { sessionId = sid; out.session = 'YES'; out.result = 'PASS'; }
} catch (e) {
  out.functional = `erro de rede/timeout (${e?.name ?? 'Error'})`;
} finally {
  password = null; // drop the only reference; never written anywhere
}
// Identity lookup (UNVALIDATED until this runs with a real login): structure only, never prints CODUSU/CODVEND values.
let identity = 'n/a (sem sessao)';
if (sessionId) {
  try {
    const field = process.env.PROBE_LOGIN_FIELD || 'NOMEUSU';
    if (!/^[A-Z][A-Z0-9_]{1,30}$/.test(field)) throw new Error('PROBE_LOGIN_FIELD invalido');
    const body = { serviceName: 'CRUDServiceProvider.loadRecords', requestBody: { dataSet: { rootEntity: 'Usuario', includePresentationFields: 'N', offsetPage: '0', criteria: { expression: { $: `this.${field} = ?` }, parameter: [{ $: username, type: 'S' }] }, entity: { fieldset: { list: 'CODUSU,CODVEND' } } } } };
    const r = await post(`/mge/service.sbr?serviceName=CRUDServiceProvider.loadRecords&outputType=json&mgeSession=${encodeURIComponent(sessionId)}`, body, sessionId);
    const ent = r.json?.responseBody?.entities;
    const rawRows = ent?.entity;
    const rows = Array.isArray(rawRows) ? rawRows.length : rawRows ? 1 : 0;
    const names = [].concat(ent?.metadata?.fields?.field ?? []).map((f) => f?.name).join(',');
    const row = Array.isArray(rawRows) ? rawRows[0] : rawRows;
    const i = (n) => [].concat(ent?.metadata?.fields?.field ?? []).findIndex((f) => f?.name === n);
    const has = (n) => (i(n) >= 0 && row?.[`f${i(n)}`]?.$ !== undefined ? 'YES' : 'NO');
    identity = `HTTP ${r.http} status=${r.json?.status ?? '?'} linhas=${rows} campos=[${names}] CODUSU=${has('CODUSU')} CODVEND=${has('CODVEND')} tsErrorCode=${clean(r.json?.tsError?.tsErrorCode, [username])}`;
  } catch (e) { identity = `falhou (${e?.name ?? 'Error'})`; }
}
out.identity = identity;
if (sessionId) {
  try {
    const l = await post(`/mge/service.sbr?serviceName=MobileLoginSP.logout&outputType=json&mgeSession=${encodeURIComponent(sessionId)}`, { serviceName: 'MobileLoginSP.logout', requestBody: {} }, sessionId);
    out.logout = `HTTP ${l.http} status=${l.json?.status ?? '?'}`;
  } catch (e) { out.logout = `falhou (${e?.name ?? 'Error'})`; }
  sessionId = null;
}
console.log(`AUTH_SANKHYA_USER = ${out.result}\nHTTP = ${out.http}\nstatus funcional = ${out.functional}\nstatusMessage = ${out.message}\ntsErrorCode = ${out.errCode}\ntsErrorLevel = ${out.errLevel}\njsessionId recebido = ${out.session}\nidentidade (CODUSU/CODVEND) = ${out.identity}\nlogout = ${out.logout}`);
