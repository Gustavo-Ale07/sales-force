// Sankhya TEST end-user login probe (MobileLoginSP.login). Spike only; NOT application code.
// Reads username + password from the TTY (password not echoed) or, when stdin is piped, from two lines.
// Prints ONLY structure: AUTH_SANKHYA_USER, HTTP, functional status, jsessionid received, structural metadata of idusu (never its value), logout, idusu stable across two logins YES/NO.
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
// idusu = Base64(decimal CODUSU) plus transport whitespace. Only ASCII space/TAB/CR/LF are removed; no case or padding change.
const normalizeB64 = (text) => (typeof text === 'string' ? text.replace(/[ \t\r\n]/g, '') : null);
// Strict canonical Base64 (standard alphabet, "=" padding): decode, re-encode, compare. Returns the decoded text or null.
function strictB64(text) {
  const n = normalizeB64(text);
  if (n === null || n.length === 0 || n.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(n)) return null;
  const buf = Buffer.from(n, 'base64');
  return buf.toString('base64') === n ? buf.toString('utf8') : null;
}
// Decoded decimal string (^[0-9]+$, 1..18 digits) or null.
function decodeIdusu(text) {
  const t = strictB64(text);
  return t !== null && /^[0-9]{1,18}$/.test(t) ? t : null;
}
const yn = (c) => (c ? 'YES' : 'NO');
// idusu extraction: direct string/number or {$: value}; NO trim, NO case change, NO zero stripping, NO numeric conversion.
function idusuOf(raw) {
  const inner = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.$ : raw;
  if (typeof inner === 'string') return inner;
  if (typeof inner === 'number' && Number.isFinite(inner)) return String(inner);
  return null;
}
// Structural metadata of the idusu property. Never the value itself.
function describeIdusu(rb) {
  const has = rb !== null && typeof rb === 'object' && Object.prototype.hasOwnProperty.call(rb, 'idusu');
  const raw = has ? rb.idusu : undefined;
  const isObj = raw !== null && typeof raw === 'object' && !Array.isArray(raw);
  const wrapped = isObj && Object.prototype.hasOwnProperty.call(raw, '$');
  const inner = wrapped ? raw.$ : raw;
  const text = typeof inner === 'string' ? inner : typeof inner === 'number' ? String(inner) : null;
  const t = text ?? '';
  return [
    `idusu propriedade existe = ${yn(has)}`,
    `idusu typeof bruto = ${has ? (raw === null ? 'null' : typeof raw) : 'n/a'}`,
    `idusu e array = ${yn(Array.isArray(raw))}`,
    `idusu chaves do objeto = ${isObj ? Object.keys(raw).slice(0, 10).map((k) => clean(k, [])).join(',') || '(nenhuma)' : 'n/a'}`,
    `idusu possui wrapper $ = ${yn(wrapped)}`,
    `idusu typeof dentro de $ = ${wrapped ? (inner === null ? 'null' : typeof inner) : 'n/a'}`,
    `idusu comprimento = ${text === null ? 'n/a' : t.length}`,
    `idusu apenas digitos = ${text === null ? 'n/a' : yn(/^[0-9]+$/.test(t))}`,
    `idusu parece UUID = ${text === null ? 'n/a' : yn(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t))}`,
    `idusu parece hexadecimal = ${text === null ? 'n/a' : yn(/^(0x)?[0-9a-f]+$/i.test(t))}`,
    `idusu parece base64/base64url = ${text === null ? 'n/a' : yn(/^([A-Za-z0-9+/]+={0,2}|[A-Za-z0-9_-]+)$/.test(t) && t.length >= 8)}`,
    `idusu contem espacos = ${text === null ? 'n/a' : yn(/s/.test(t))}`,
    `idusu contem caracteres de controle = ${text === null ? 'n/a' : yn(/[\u0000-\u001f\u007f]/.test(t))}`,
    `idusu vazio = ${text === null ? 'n/a' : yn(t.length === 0)}`,
    `idusu Base64 normalizado valido = ${text === null ? 'n/a' : yn(strictB64(t) !== null)}`,
    `idusu Base64 decodifica para decimal (^[0-9]+$) = ${text === null ? 'n/a' : yn(decodeIdusu(t) !== null)}`,
    `idusu decodificado comprimento = ${text === null || decodeIdusu(t) === null ? 'n/a' : decodeIdusu(t).length}`,
  ];
}

// One login + logout. Returns structure only; `id` (the idusu value) stays in memory for the stability comparison and is never printed.
async function loginOnce() {
  const r = { http: 'n/a', functional: 'n/a', message: 'n/a', errCode: 'n/a', errLevel: 'n/a', session: 'NO', idusu: 'NO', meta: [], logout: 'n/a', pass: false, id: null, dec: null };
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
    r.meta = describeIdusu(rb);
    const id = idusuOf(rb?.idusu);
    if (id !== null && id !== '') { r.idusu = 'YES'; r.id = id; r.dec = decodeIdusu(id); }
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
let stableDecoded = 'n/a';
if (first.pass && first.id !== null) {
  const second = await loginOnce();
  stable = second.pass && second.id === first.id ? 'YES' : 'NO';
  if (first.dec !== null) stableDecoded = second.pass && second.dec === first.dec ? 'YES' : 'NO';
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
  ...first.meta,
  `logout = ${first.logout}`,
  `idusu estavel entre dois logins (valor bruto) = ${stable}`,
  `idusu decodificado estavel entre dois logins = ${stableDecoded}`,
].join('\n'));
