import { describe, expect, it } from 'vitest';
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

const OK_LOGIN = { status: '1', responseBody: { jsessionid: { $: SESSION } } };
const REJECTED = { status: '0', statusMessage: 'rejected', tsError: { tsErrorCode: 'CORE_E01434' } };
const FIELDS = { fields: { field: [{ name: 'CODUSU' }, { name: 'CODVEND' }] } };
const identityRow = (codusu: string, codvend: string) => ({
  status: '1',
  responseBody: { entities: { total: '1', metadata: FIELDS, entity: { f0: { $: codusu }, f1: { $: codvend } } } },
});

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

const verify = (fetchImpl: typeof fetch, outcomes: string[] = []) =>
  new SankhyaLoginVerification({
    origin: ORIGIN,
    loginField: 'NOMEUSU',
    fetchImpl,
    now: () => new Date('2026-10-07T12:00:00Z'),
    onOutcome: (o) => outcomes.push(o),
  }).verify({ login: LOGIN, password: PASSWORD } as never, new AbortController().signal);

describe('SankhyaLoginVerification', () => {
  it('valid user: identity from CODUSU/CODVEND, session only server-side, logout called, no secret in result', async () => {
    const { calls, fetchImpl } = fake({
      'MobileLoginSP.login': () => json(OK_LOGIN),
      'CRUDServiceProvider.loadRecords': () => json(identityRow('42', '7')),
      'MobileLoginSP.logout': () => json({ status: '1' }),
    });
    const result = await verify(fetchImpl);
    expect(result).toMatchObject({ ok: true, codusu: 42, codvend: 7, active: true });
    expect(JSON.stringify(result)).not.toContain(SESSION);
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(calls.map((c) => c.service)).toEqual([
      'MobileLoginSP.login',
      'CRUDServiceProvider.loadRecords',
      'MobileLoginSP.logout',
    ]);
    expect(calls.every((c) => c.url.startsWith(`${ORIGIN}/mge/service.sbr?`))).toBe(true);
    expect(calls[0]?.cookie).toBeUndefined();
    expect(calls[1]?.cookie).toBe(`JSESSIONID=${SESSION}`);
    expect(calls[2]?.cookie).toBe(`JSESSIONID=${SESSION}`);
    expect(calls[1]?.bodyText).not.toContain(PASSWORD);
  });

  it('CODVEND 0 means no seller', async () => {
    const { fetchImpl } = fake({
      'MobileLoginSP.login': () => json(OK_LOGIN),
      'CRUDServiceProvider.loadRecords': () => json(identityRow('42', '0')),
      'MobileLoginSP.logout': () => json({ status: '1' }),
    });
    expect(await verify(fetchImpl)).toMatchObject({ ok: true, codusu: 42, codvend: null });
  });

  it('wrong password / unknown user (CORE_E01434): denial, nothing else is called', async () => {
    const { calls, fetchImpl } = fake({ 'MobileLoginSP.login': () => json(REJECTED) });
    const outcomes: string[] = [];
    const result = await verify(fetchImpl, outcomes);
    expect(result).toMatchObject({ ok: false });
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

  it.each([
    ['no row', () => json({ status: '1', responseBody: { entities: { total: '0', metadata: FIELDS } } })],
    [
      'two rows',
      () =>
        json({
          status: '1',
          responseBody: { entities: { metadata: FIELDS, entity: [{ f0: { $: '1' }, f1: { $: '0' } }, { f0: { $: '2' }, f1: { $: '0' } }] } },
        }),
    ],
    ['CODUSU not a positive integer', () => json(identityRow('abc', '1'))],
    ['lookup HTTP error', () => json({}, 500)],
  ] as Array<[string, Handler]>)('identity cannot be established (%s): throws and the session is still closed', async (_l, lookup) => {
    const { calls, fetchImpl } = fake({
      'MobileLoginSP.login': () => json(OK_LOGIN),
      'CRUDServiceProvider.loadRecords': lookup,
      'MobileLoginSP.logout': () => json({ status: '1' }),
    });
    await expect(verify(fetchImpl)).rejects.toThrow(/unavailable/);
    expect(calls.at(-1)?.service).toBe('MobileLoginSP.logout');
  });

  it('a failing logout never changes the verdict', async () => {
    const { fetchImpl } = fake({
      'MobileLoginSP.login': () => json(OK_LOGIN),
      'CRUDServiceProvider.loadRecords': () => json(identityRow('9', '3')),
      'MobileLoginSP.logout': () => Promise.reject(new Error('boom')),
    });
    expect(await verify(fetchImpl)).toMatchObject({ ok: true, codusu: 9 });
  });

  it('never reports password, login or session through outcomes or errors', async () => {
    const outcomes: string[] = [];
    const { fetchImpl } = fake({ 'MobileLoginSP.login': () => json({ status: '0', tsError: { tsErrorCode: 'CORE_E00001' } }) });
    const error = await verify(fetchImpl, outcomes).catch((e: unknown) => e);
    const text = `${String(error)} ${outcomes.join(' ')}`;
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(LOGIN);
    expect(text).not.toContain(SESSION);
  });
});
