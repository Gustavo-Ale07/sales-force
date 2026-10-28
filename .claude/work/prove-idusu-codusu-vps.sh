#!/usr/bin/env bash
# SANDBOX-ONLY, READ-ONLY proof that the decoded Sankhya login `idusu` == TSIUSU.CODUSU (staging VPS).
#   sudo bash prove-idusu-codusu-vps.sh
# A) orchestration (host)   B) human auth inside VERIFIER   C) technical read inside WORKER   D) result.
# No VPS/config change. Nothing from any environment is printed (only hostname/mode lines below). Passwords: hidden prompts ->
# `docker exec -e NAME` passthrough (not in argv) -> unset on exit.
set -u
PROJECT="${SF_COMPOSE_PROJECT:-salesforce-staging}"
cid() { docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" | head -n1; }

# ===== A) host / orchestration =====
VF="$(cid verifier)"; WK="$(cid worker)"
[ -n "$VF" ] || { echo "STOP: no running verifier container in $PROJECT"; exit 2; }
[ -n "$WK" ] || { echo "STOP: no running worker container in $PROJECT"; exit 2; }
trap 'unset PROOF_A_LOGIN PROOF_A_PASS PROOF_B_LOGIN PROOF_B_PASS PROOF_A_AUTH PROOF_A_ID PROOF_B_AUTH PROOF_B_ID' EXIT

read -r  -p "User A login: "    PROOF_A_LOGIN
read -rs -p "User A password: " PROOF_A_PASS; echo
read -r  -p "User B login: "    PROOF_B_LOGIN
read -rs -p "User B password: " PROOF_B_PASS; echo
export PROOF_A_LOGIN PROOF_A_PASS PROOF_B_LOGIN PROOF_B_PASS

# ===== B) human auth inside the VERIFIER container =====
# Reads only VERIFIER_MODE and VERIFIER_SANKHYA_BASE_URL. stdout = `diag ...` lines and `A|B auth=OK|FAILED id=<decimal>|-`.
STAGE_B="$(docker exec -i -e PROOF_A_LOGIN -e PROOF_A_PASS -e PROOF_B_LOGIN -e PROOF_B_PASS "$VF" node --input-type=module - <<'NODE_VERIFIER'
const SANDBOX_HOST = 'placfestas-teste.sankhyacloud.com.br';
const env = process.env;
let origin = null; let host = '-';
try {
  const u = new URL(env.VERIFIER_SANKHYA_BASE_URL ?? '');
  host = u.host.toLowerCase();
  if (u.protocol === 'https:' && host === SANDBOX_HOST) origin = `https://${host}`;
} catch { /* origin stays null */ }
console.log(`diag verifier_mode=${env.VERIFIER_MODE ?? '-'} verifier_host=${host}`);
if (env.VERIFIER_MODE !== 'live' || origin === null) { console.log('diag refused=1'); process.exit(0); }

// Same strict decoding as apps/server/src/verifier/sankhya-login.ts.
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

for (const label of ['A', 'B']) {
  const login = (env[`PROOF_${label}_LOGIN`] ?? '').trim();
  const password = env[`PROOF_${label}_PASS`] ?? '';
  let auth = 'FAILED'; let id = '-';
  if (login !== '' && password !== '') {
    try {
      const res = await fetch(`${origin}/mge/service.sbr?serviceName=MobileLoginSP.login&outputType=json`, {
        method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serviceName: 'MobileLoginSP.login', requestBody: { NOMUSU: { $: login }, INTERNO: { $: password }, KEEPCONNECTED: { $: 'N' } } }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 200) {
        const body = await res.json().catch(() => null);
        const session = scalar(body?.responseBody?.jsessionid);
        if (session && session !== 'undefined') {
          auth = 'OK';
          const decoded = decodeIdusu(body?.responseBody?.idusu);
          if (decoded !== null) id = decoded;
          await fetch(`${origin}/mge/service.sbr?serviceName=MobileLoginSP.logout&outputType=json&mgeSession=${encodeURIComponent(session)}`, {
            method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', cookie: `JSESSIONID=${session}` },
            body: JSON.stringify({ serviceName: 'MobileLoginSP.logout', requestBody: {} }), signal: AbortSignal.timeout(5_000),
          }).catch(() => undefined);
        }
      }
    } catch { /* auth stays FAILED */ }
  }
  console.log(`${label} auth=${auth} id=${id}`);
}
NODE_VERIFIER
)"
RC_B=$?
unset PROOF_A_PASS PROOF_B_PASS
echo "$STAGE_B" | grep -E '^diag verifier_mode=[A-Za-z0-9_-]{1,20} verifier_host=[a-z0-9.:-]{1,80}$' | sed 's/^diag //'
if [ "$RC_B" -ne 0 ] || echo "$STAGE_B" | grep -q '^diag refused=1$'; then
  echo "STOP: verifier must be VERIFIER_MODE=live with an https host of exactly placfestas-teste.sankhyacloud.com.br. Nothing else was done."
  exit 3
fi
for L in A B; do
  line="$(printf '%s\n' "$STAGE_B" | grep -E "^$L auth=(OK|FAILED) id=([0-9]{1,18}|-)$" | head -n1)"
  auth="$(printf '%s' "$line" | sed -n 's/^[AB] auth=\([A-Z]*\) id=.*$/\1/p')"
  id="$(printf '%s' "$line" | sed -n 's/^[AB] auth=[A-Z]* id=\(.*\)$/\1/p')"
  [ -n "$auth" ] || { auth=FAILED; id="-"; }
  export "PROOF_${L}_AUTH=$auth" "PROOF_${L}_ID=$id"
done

# ===== C) technical read inside the WORKER container =====
# Guard = SANKHYA_MODE=live + SANKHYA_ENVIRONMENT=sandbox + https + the worker's own base host listed in SANKHYA_ALLOWED_HOSTS.
docker exec -i -e PROOF_A_LOGIN -e PROOF_B_LOGIN -e PROOF_A_AUTH -e PROOF_B_AUTH -e PROOF_A_ID -e PROOF_B_ID "$WK" node --input-type=module - <<'NODE_WORKER'
const env = process.env;
const stop = (m) => { console.log(`STOP: ${m}`); process.exit(3); };
const modeOk = env.SANKHYA_MODE === 'live';
const envOk = (env.SANKHYA_ENVIRONMENT ?? '').toLowerCase() === 'sandbox';
console.log(`worker mode: ${env.SANKHYA_MODE ?? '-'}`);
console.log(`worker environment: ${(env.SANKHYA_ENVIRONMENT ?? '-').toLowerCase()}`);
if (!modeOk || !envOk) stop('worker must be SANKHYA_MODE=live and SANKHYA_ENVIRONMENT=sandbox');
let origin = null; let baseHost = null;
try {
  const u = new URL(env.SANKHYA_BASE_URL ?? '');
  if (u.protocol === 'https:') { baseHost = u.host.toLowerCase(); origin = `https://${baseHost}`; }
} catch { /* origin stays null */ }
if (origin === null) stop('worker base URL is not a valid https URL');
const allowedHosts = (env.SANKHYA_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const hostListed = allowedHosts.includes(baseHost);
console.log(`worker base host allowed: ${hostListed ? 'YES' : 'NO'}`);
if (!hostListed) stop('worker base host is not listed in SANKHYA_ALLOWED_HOSTS');
for (const name of ['SANKHYA_CLIENT_ID', 'SANKHYA_CLIENT_SECRET', 'SANKHYA_X_TOKEN']) {
  if (!env[name]) stop('a technical credential is missing in the worker');
}
const sameHost = (url) => { if (new URL(url).host.toLowerCase() !== baseHost) stop('request host differs from the checked base host'); return url; };

const tokenResponse = await fetch(sameHost(`${origin}/authenticate`), {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'x-token': env.SANKHYA_X_TOKEN },
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.SANKHYA_CLIENT_ID, client_secret: env.SANKHYA_CLIENT_SECRET }).toString(),
  signal: AbortSignal.timeout(20_000),
}).catch(() => null);
if (!tokenResponse || tokenResponse.status !== 200) stop(`technical authentication failed (HTTP ${tokenResponse?.status ?? 'network'})`);
const accessToken = (await tokenResponse.json().catch(() => ({}))).access_token;
if (typeof accessToken !== 'string') stop('technical authentication returned no token');

async function select(sql) {
  const text = sql.trim();
  if (!/^select\s/i.test(text) || /;|--|\/\*/.test(text)) stop('refused: only one plain SELECT');
  const res = await fetch(sameHost(`${origin}/gateway/v1/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json`), {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ serviceName: 'DbExplorerSP.executeQuery', requestBody: { sql: text } }),
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  const json = res ? await res.json().catch(() => null) : null;
  if (!res || res.status !== 200 || !json || String(json.status) !== '1') return { error: true, rows: [] };
  return { error: false, rows: json.responseBody?.rows ?? [] };
}

// TSIUSU login column from the physical dictionary (never assumed); used only for the additional login-evidence line.
const dictionary = await select("SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'TSIUSU' AND COLUMN_NAME IN ('NOMEUSU','NOMUSU')");
const loginColumns = dictionary.rows.map((r) => String(r[0]));
const loginColumn = loginColumns.includes('NOMEUSU') ? 'NOMEUSU' : (loginColumns[0] ?? null);

const yn = (b) => (b ? 'YES' : 'NO');
const users = [];
for (const label of ['A', 'B']) {
  const login = (env[`PROOF_${label}_LOGIN`] ?? '').trim();
  const decodedId = env[`PROOF_${label}_ID`] ?? '-';
  const u = {
    label, authOk: env[`PROOF_${label}_AUTH`] === 'OK', decoded: /^[0-9]{1,18}$/.test(decodedId),
    rowFound: false, idEqualsCodusu: false, loginMatches: false, hasVend: false, sellerExists: false, sellerActive: false, sharing: 'n/a',
  };
  users.push(u);
  if (!u.authOk || !u.decoded) continue;
  const row = await select(`SELECT CODUSU, CODVEND${loginColumn ? `, UPPER(${loginColumn})` : ''} FROM TSIUSU WHERE CODUSU = ${Number(decodedId)}`);
  if (row.error || row.rows.length !== 1) continue;
  u.rowFound = true;
  const [codusu, codvend, loginInRow] = row.rows[0];
  u.idEqualsCodusu = String(codusu) === decodedId;
  u.loginMatches = loginColumn !== null && String(loginInRow ?? '').trim() === login.toUpperCase();
  u.hasVend = codvend !== null && Number(codvend) > 0;
  if (u.hasVend) {
    const seller = await select(`SELECT ATIVO FROM TGFVEN WHERE CODVEND = ${Number(codvend)}`);
    u.sellerExists = !seller.error && seller.rows.length === 1;
    u.sellerActive = u.sellerExists && String(seller.rows[0][0]) === 'S';
    const shared = await select(`SELECT COUNT(*) FROM TSIUSU WHERE CODVEND = ${Number(codvend)}`);
    u.sharing = shared.error ? 'n/a' : String(shared.rows[0]?.[0]);
  }
}

// ===== D) result =====
for (const u of users) {
  console.log(`\nUSER ${u.label}`);
  console.log(`human auth: ${u.authOk ? 'OK' : 'FAILED'}`);
  console.log(`idusu decoded: ${yn(u.decoded)}`);
  console.log(`TSIUSU row found: ${yn(u.rowFound)}`);
  console.log(`idusu == CODUSU: ${yn(u.idEqualsCodusu)}`);
  console.log(`(extra evidence) login of that TSIUSU row == login that authenticated: ${yn(u.loginMatches)}`);
  console.log(`has CODVEND: ${yn(u.hasVend)}`);
  console.log(`seller exists: ${yn(u.sellerExists)}`);
  console.log(`seller active: ${yn(u.sellerActive)}`);
  console.log(`users sharing CODVEND: ${u.sharing}`);
}
// idusu == CODUSU is the claim; the row's own login is what makes it non-tautological (a row exists for any valid id),
// so OVERALL needs both.
console.log(`\nOVERALL: ${users.every((u) => u.idEqualsCodusu && u.loginMatches) ? 'PROOF OK' : 'NOT PROVEN'}`);
NODE_WORKER
RC_C=$?
echo "exit code: $RC_C"
echo "Read-only. EXTERNAL_AUTO_PROVISION / EXTERNAL_IDUSU_IS_CODUSU_VALIDATED untouched."
