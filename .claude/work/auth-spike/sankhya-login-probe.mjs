// Sankhya TEST end-user login probe (MobileLoginSP.login). Spike only; NOT application code.
// Reads username + password from the TTY (password not echoed) or, when stdin is piped, from two lines.
// Prints ONLY structure: AUTH_SANKHYA_USER, HTTP, functional status, jsessionid/idusu received + idusu format YES/NO, logout, idusu stable across two logins YES/NO.
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

// Diagnostic fields only (statusMessage, tsError code/level). Sanitized: secrets never echoed, length-capped, single line.
function clean(v, secrets) {
  if (v === undefined || v === null) return 'n/a';
  let t = String(v).replace(/\s+/g, ' ');
  for (const x of secrets) if (x && x.length >= 3) t = t.split(x).join('[redacted]');
  return t.length > 200 ? t.slice(0, 200) + '...' : t;
}
const scalar = (v) => { const raw = v && typeof v === 'object' && !Array.isArray(v) ? v.$ : v; return typeof raw === 'string' || (typeof raw === 'number' && Number.isSafeInteger(raw)) ? String(raw).trim() : null; };

// One login + logout. Returns structure only; `id` (the idusu value) stays in memory for the stability comparison and is never printed.
async function loginOnce() {
  const r = { http: 'n/a', functional: 'n/a', message: 'n/a', errCode: 'n/a', errLevel: 'n/a', session: 'NO', idusu: 'NO', idFormat: 'NO', logout: 'n/a', pass: false, id: null };
  let sessionId = null;
  try {
    const body = { serviceName: 'MobileLoginSP.login', requestBody: { NOMUSU: { $: username }, INTERNO: { $: password }, KEEPCONNECTED: { $: 'N' } } };
    const p = await post('/mge/service.sbr?serviceName=MobileLoginSP.login&outputType=json', body);
    const secrets = [password, username];
    r.http = p.http;
    r.functional = p.json === null ? 'resposta nao-JSON' : `status=${p.json.status ?? '?'}`;
    r.message = clean(p.json?.statusMessage, secrets);
    r.errCode = clean(p.json?.tsError?.tsErrorCode, secrets);
    r.errLevel = clean(p.json?.tsError?.tsErrorLevel, secrets);
    const rb = p.json?.responseBody;
    const sid = scalar(rb?.jsessionid);
    if (sid && sid !== 'undefined') { sessionId = sid; r.session = 'YES'; }
    const id = scalar(rb?.idusu);
    if (id !== null && id !== '') { r.idusu = 'YES'; if (/^[0-9]{1,18}$/.test(id) && !/^0+$/.test(id)) { r.idFormat = 'YES'; r.id = id.replace(/^0+(?=\d)/, ''); } }
    r.pass = r.session === 'YES' && String(p.json?.status) === '1';
  } catch (e) {
    r.functional = `erro de rede/timeout (${e?.name ?? 'Error'})`;
  }
  if (sessionId) {
    try {
      const l = await post(`/mge/service.sbr?serviceName=MobileLoginSP.logout&outputType=json&mgeSession=${encodeURIComponent(sessionId)}`, { serviceName: 'MobileLoginSP.logout', requestBody: {} }, sessionId);
      r.logout = `HTTP ${l.http} status=${l.json?.status ?? '?'}`;
    } catch (e) { r.logout = `falhou (${e?.name ?? 'Error'})`; }
    sessionId = null;
  }
  return r;
}

const first = await loginOnce();
let stable = 'n/a';
if (first.pass && first.id !== null) {
  const second = await loginOnce();
  stable = second.pass && second.id === first.id ? 'YES' : 'NO';
}
password = null; // drop the only reference; never written anywhere
console.log([
  `AUTH_SANKHYA_USER = ${first.pass ? 'PASS' : 'FAIL'}`,
  `HTTP = ${first.http}`,
  `status funcional = ${first.functional}`,
  `statusMessage = ${first.message}`,
  `tsErrorCode = ${first.errCode}`,
  `tsErrorLevel = ${first.errLevel}`,
  `jsessionId recebido = ${first.session}`,
  `idusu recebido = ${first.idusu}`,
  `idusu formato valido = ${first.idFormat}`,
  `logout = ${first.logout}`,
  `idusu estavel entre dois logins = ${stable}`,
].join('\n'));
