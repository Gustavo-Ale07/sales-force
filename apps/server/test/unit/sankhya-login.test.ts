import { describe, expect, it } from 'vitest';
import { verifiedIdentitySchema } from '../../src/verifier/contract.js';
import { SankhyaLoginVerification } from '../../src/verifier/sankhya-login.js';

const ORIGIN = 'https://placfestas-teste.sankhyacloud.com.br';
const PASSWORD = 'Sankhya-pw-never-logged-4821';
const LOGIN = 'maria.vendas';
const SESSION = 'SESSION-ID-NEVER-RETURNED-99';

interface Call {
  readonly service: string;
  readonly url: string;
  readonly cookie: string | undefined;
  readonly bodyText: string;
}

const okLogin = (idusu: unknown) => ({ status: '1', responseBody: { callID: 'x', jsessionid: { $: SESSION }, idusu } });
const REJECTED = { status: '0', statusMessage: 'rejected', tsError: { tsErrorCode: 'CORE_E01434' } };

type Handler = () => Response | Promise<Response>;

function fake(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const service = /serviceName=([A-Za-z.]+)/.exec(url)?.[1] ?? '';
    const headers = new Headers(init?.headers);
    calls.push({ service, url, cookie: headers.get('cookie') ?? undefined, bodyText: String(init?.body) });
    const handler = handlers[service];
    if (handler === undefined) throw new Error(`unexpected ${service}`);
    return handler();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const logoutOk: Handler = () => json({ status: '1' });

const verify = (fetchImpl: typeof fetch, outcomes: string[] = []) =>
  new SankhyaLoginVerification({
    origin: ORIGIN,
    fetchImpl,
    now: () => new Date('2026-10-07T12:00:00Z'),
    onOutcome: (o) => outcomes.push(o),
  }).verify({ login: LOGIN, password: PASSWORD }, new AbortController().signal);

describe('SankhyaLoginVerification (MobileLoginSP.login only)', () => {
  it('valid login: identity from the login response itself, one login + one logout, nothing else, no secret in the result', async () => {
    const { calls, fetchImpl } = fake({
      'MobileLoginSP.login': () => json(okLogin({ $: '42' })),
      'MobileLoginSP.logout': logoutOk,
    });
    const outcomes: string[] = [];
    const result = await verify(fetchImpl, outcomes);
    expect(result).toEqual({ ok: true, externalUserId: '42', username: LOGIN, active: true, verifiedAt: '2026-10-07T12:00:00.000Z' });
    expect(verifiedIdentitySchema.safeParse(result).success).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SESSION);
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    // No user lookup: neither CRUDServiceProvider nor SessionManagerSP is ever called.
    expect(calls.map((c) => c.service)).toEqual(['MobileLoginSP.login', 'MobileLoginSP.logout']);
    expect(calls.every((c) => c.url.startsWith(`${ORIGIN}/mge/service.sbr?`))).toBe(true);
    expect(calls[0]?.cookie).toBeUndefined();
    expect(calls[1]?.cookie).toBe(`JSESSIONID=${SESSION}`);
    expect(calls[1]?.bodyText).not.toContain(PASSWORD);
    expect(outcomes).toEqual(['verified']);
    expect(outcomes.join(' ')).not.toMatch(/42|maria|Sankhya-pw|SESSION/);
  });

  it.each([
    ['wrapped {$: "42"}', { $: '42' }, '42'],
    ['wrapped {$: 42}', { $: 42 }, '42'],
    ['bare string', '42', '42'],
    ['bare number', 42, '42'],
    ['leading zeros normalized', { $: '0042' }, '42'],
  ])('idusu format accepted: %s', async (_label, idusu, expected) => {
    const { fetchImpl } = fake({ 'MobileLoginSP.login': () => json(okLogin(idusu)), 'MobileLoginSP.logout': logoutOk });
    expect(await verify(fetchImpl)).toMatchObject({ ok: true, externalUserId: expected });
  });

  it.each([
    ['absent', undefined],
    ['empty', { $: '' }],
    ['blank', '   '],
    ['zero', { $: '0' }],
    ['negative', { $: '-5' }],
    ['not digits', { $: '12ab' }],
    ['injection-looking', { $: "1' OR '1'='1" }],
    ['too long', { $: '1'.repeat(40) }],
    ['object', { a: 1 }],
    ['array', [1]],
    ['float', 1.5],
    ['boolean', true],
  ])('idusu invalid (%s): unavailable, never a credential verdict, session still closed', async (_label, idusu) => {
    const { calls, fetchImpl } = fake({ 'MobileLoginSP.login': () => json(okLogin(idusu)), 'MobileLoginSP.logout': logoutOk });
    await expect(verify(fetchImpl)).rejects.toThrow(/unavailable/);
    expect(calls.at(-1)?.service).toBe('MobileLoginSP.logout');
  });

  it('status 1 without jsessionid: unavailable', async () => {
    const { calls, fetchImpl } = fake({ 'MobileLoginSP.login': () => json({ status: '1', responseBody: { idusu: { $: '7' } } }) });
    await expect(verify(fetchImpl)).rejects.toThrow(/unavailable/);
    expect(calls).toHaveLength(1);
  });

  it('wrong password or unknown user (CORE_E01434): uniform denial, nothing else is called', async () => {
    const { calls, fetchImpl } = fake({ 'MobileLoginSP.login': () => json(REJECTED) });
    const outcomes: string[] = [];
    expect(await verify(fetchImpl, outcomes)).toEqual({ ok: false, code: 'denied' });
    expect(calls).toHaveLength(1);
    expect(outcomes).toEqual(['credentials_rejected']);
  });

  it.each([
    ['network error', () => Promise.reject(new TypeError('fetch failed'))],
    ['HTTP 503', () => json({}, 503)],
    ['HTTP 401', () => json({}, 401)],
    ['non-JSON body', () => new Response('<html>down</html>', { status: 200 })],
    ['unknown functional error', () => json({ status: '0', tsError: { tsErrorCode: 'CORE_E99999' } })],
    ['status 0 without code', () => json({ status: '0' })],
  ] as Array<[string, Handler]>)('Sankhya unavailable or unclassified (%s): throws, never a credential verdict', async (_l, handler) => {
    const { fetchImpl } = fake({ 'MobileLoginSP.login': handler });
    await expect(verify(fetchImpl)).rejects.toThrow(/unavailable/);
  });

  it('a failing logout never changes the verdict and leaks nothing', async () => {
    const { fetchImpl } = fake({
      'MobileLoginSP.login': () => json(okLogin({ $: '9' })),
      'MobileLoginSP.logout': () => Promise.reject(new Error(`boom ${SESSION}`)),
    });
    const result = await verify(fetchImpl);
    expect(result).toMatchObject({ ok: true, externalUserId: '9' });
    expect(JSON.stringify(result)).not.toContain(SESSION);
  });

  it('never reports password, login, id or session through outcomes or errors', async () => {
    const outcomes: string[] = [];
    const { fetchImpl } = fake({ 'MobileLoginSP.login': () => json({ status: '0', tsError: { tsErrorCode: 'CORE_E00001' } }) });
    const error = await verify(fetchImpl, outcomes).catch((e: unknown) => e);
    const text = `${String(error)} ${outcomes.join(' ')}`;
    for (const secret of [PASSWORD, LOGIN, SESSION]) expect(text).not.toContain(secret);
  });
});
