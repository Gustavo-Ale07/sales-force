import { describe, expect, it } from 'vitest';
import {
  FakeGateway,
  FakeUserPhotoBook,
  NotImplementedError,
  RealSankhyaGateway,
  SankhyaGatewayError,
  Secret,
  buildUserPhotoRequestText,
  parseProfilePhotoWriteSettings,
  parseUserPhotoResponse,
  type SankhyaProfilePhotoPort,
  type UserPhotoWriteRequest,
} from '../src/index.js';
import type { HttpResponse, HttpTransport } from '../src/real/transport.js';
import { MockSankhya, TEST_CREDENTIALS, type ClockRef } from './support/mock-sankhya.js';

const ON = {
  SANKHYA_PROFILE_PHOTO_WRITE_ENABLED: 'true',
  SANKHYA_MODE: 'live',
  SANKHYA_ENVIRONMENT: 'sandbox',
  SANKHYA_BASE_URL: 'https://api.sandbox.sankhya.com.br',
  SF_DEPLOY_ENVIRONMENT: 'staging',
};

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
const KEY = 'photo:0198f0a2-7b1c-7c3e-9a55-0123456789ab:0123456789abcdef0123456789abcdef';

function request(overrides: Partial<UserPhotoWriteRequest> = {}): UserPhotoWriteRequest {
  return { userCode: 42, image: JPEG, idempotencyKey: KEY, ...overrides };
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (e: unknown) => e,
  );
}

describe('profile photo write settings (flag closed by default)', () => {
  it('is closed by default and needs nothing', () => {
    expect(parseProfilePhotoWriteSettings({})).toEqual({ settings: { enabled: false }, problems: [] });
    expect(parseProfilePhotoWriteSettings({ SANKHYA_PROFILE_PHOTO_WRITE_ENABLED: 'false' }).settings.enabled).toBe(false);
  });

  it('opens only on staging, against the Sandbox allowlist, in explicit sandbox live mode', () => {
    expect(parseProfilePhotoWriteSettings(ON)).toEqual({ settings: { enabled: true }, problems: [] });
  });

  it.each([
    ['production', { SF_DEPLOY_ENVIRONMENT: 'production' }],
    ['unset deploy environment', { SF_DEPLOY_ENVIRONMENT: undefined }],
    ['fake mode', { SANKHYA_MODE: 'fake' }],
    ['production Sankhya', { SANKHYA_ENVIRONMENT: 'production' }],
    ['a host outside the allowlist', { SANKHYA_BASE_URL: 'https://erp.example.test' }],
  ])('refuses at boot: %s', (_name, override) => {
    const r = parseProfilePhotoWriteSettings({ ...ON, ...override });
    expect(r.settings.enabled).toBe(false);
    expect(r.problems.length).toBeGreaterThan(0);
  });

  it('rejects garbage values', () => {
    const r = parseProfilePhotoWriteSettings({ SANKHYA_PROFILE_PHOTO_WRITE_ENABLED: 'yes' });
    expect(r.settings.enabled).toBe(false);
    expect(r.problems).toHaveLength(1);
  });
});

describe('profile photo wire (NEEDS VALIDATION shape, VALIDATED column TSIUSU.FOTO)', () => {
  it('builds a deterministic save of FOTO for the user key, base64 of the JPEG, nothing else', () => {
    const text = buildUserPhotoRequestText(request());
    expect(buildUserPhotoRequestText(request())).toBe(text);
    const body = JSON.parse(text) as { requestBody: { dataSet: { dataRow: { key: unknown; localFields: Record<string, unknown> } } } };
    const row = body.requestBody.dataSet.dataRow;
    expect(row.key).toEqual({ CODUSU: { $: '42' } });
    expect(Object.keys(row.localFields)).toEqual(['FOTO']);
    expect(row.localFields['FOTO']).toEqual({ $: Buffer.from(JPEG).toString('base64') });
    expect(text).not.toContain(KEY);
  });

  it.each([
    ['user code zero', { userCode: 0 }, 'user_photo_invalid_user'],
    ['user code not an integer', { userCode: 1.5 }, 'user_photo_invalid_user'],
    ['an image that is not a JPEG', { image: new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2]) }, 'user_photo_invalid_image'],
    ['an image over the limit', { image: new Uint8Array([0xff, 0xd8, 0xff, ...new Array<number>(512 * 1024).fill(1)]) }, 'user_photo_too_large'],
  ])('refuses before any send: %s', (_name, override, code) => {
    try {
      buildUserPhotoRequestText(request(override));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SankhyaGatewayError);
      expect((error as SankhyaGatewayError).kind).toBe('permanent');
      expect((error as SankhyaGatewayError).code).toBe(code);
      expect((error as SankhyaGatewayError).retryable).toBe(false);
    }
  });

  it('classifies responses: success, refusal (permanent, text not copied), 5xx and 429 (retryable), 401 (auth)', () => {
    expect(() => parseUserPhotoResponse(200, JSON.stringify({ status: '1' }))).not.toThrow();
    const refused = (() => {
      try {
        parseUserPhotoResponse(200, JSON.stringify({ status: '0', statusMessage: 'user 42 secret detail' }));
      } catch (e) {
        return e as SankhyaGatewayError;
      }
      throw new Error('expected a throw');
    })();
    expect(refused.kind).toBe('permanent');
    expect(refused.message).not.toContain('secret detail');
    const kindOf = (status: number): string => {
      try {
        parseUserPhotoResponse(status, '');
      } catch (e) {
        return `${(e as SankhyaGatewayError).kind}:${(e as SankhyaGatewayError).retryable}`;
      }
      return 'none';
    };
    expect(kindOf(503)).toMatch(/:true$/);
    expect(kindOf(429)).toMatch(/:true$/);
    expect(kindOf(401)).toMatch(/^auth:false$/);
    expect(() => parseUserPhotoResponse(200, 'not json')).toThrow(SankhyaGatewayError);
  });
});

/** The same behavior is required of the fake and of the real adapter (against a mocked transport, no network). */
function realHarness(open: boolean) {
  const clock: ClockRef = { now: 1_800_000_000_000 };
  const mock = new MockSankhya({ tables: {}, clock });
  const saves: string[] = [];
  const responses: HttpResponse[] = [];
  const transport: HttpTransport = (req) => {
    if (req.url.includes('CRUDServiceProvider.saveRecord')) {
      saves.push(req.body ?? '');
      return Promise.resolve(responses.shift() ?? { status: 503, headers: {}, body: '' });
    }
    return mock.transport(req);
  };
  const gateway = new RealSankhyaGateway({
    baseUrl: 'https://api.sandbox.sankhya.com.br',
    allowedHosts: ['api.sandbox.sankhya.com.br'],
    environmentKind: 'sandbox',
    credentials: {
      clientId: new Secret(TEST_CREDENTIALS.clientId),
      clientSecret: new Secret(TEST_CREDENTIALS.clientSecret),
      xToken: new Secret(TEST_CREDENTIALS.xToken),
    },
    transport,
    now: () => clock.now,
    ...(open ? { profilePhotoWrite: { enabled: true } } : {}),
  });
  return { gateway, saves, responses };
}

describe('real adapter: profile photo write', () => {
  it('flag closed: refuses with NotImplementedError and sends nothing', async () => {
    const { gateway, saves } = realHarness(false);
    const error = await failureOf(gateway.writeUserPhoto(request()));
    expect(error).toBeInstanceOf(NotImplementedError);
    expect((error as NotImplementedError).message).toContain('NEEDS VALIDATION');
    expect(saves).toHaveLength(0);
  });

  it('flag open: sends one save and resolves on status 1', async () => {
    const { gateway, saves, responses } = realHarness(true);
    responses.push({ status: 200, headers: {}, body: JSON.stringify({ status: '1' }) });
    await gateway.writeUserPhoto(request());
    expect(saves).toHaveLength(1);
    expect(saves[0]).toBe(buildUserPhotoRequestText(request()));
  });

  it('flag open: an invalid image never reaches the transport', async () => {
    const { gateway, saves } = realHarness(true);
    const error = await failureOf(gateway.writeUserPhoto(request({ image: new Uint8Array([1, 2, 3, 4]) })));
    expect((error as SankhyaGatewayError).code).toBe('user_photo_invalid_image');
    expect(saves).toHaveLength(0);
  });

  it('flag open: a refusal is permanent, a 503 is retryable', async () => {
    const { gateway, responses } = realHarness(true);
    responses.push({ status: 200, headers: {}, body: JSON.stringify({ status: '0', statusMessage: 'no' }) });
    expect(((await failureOf(gateway.writeUserPhoto(request()))) as SankhyaGatewayError).retryable).toBe(false);
    responses.push({ status: 503, headers: {}, body: '' });
    expect(((await failureOf(gateway.writeUserPhoto(request()))) as SankhyaGatewayError).retryable).toBe(true);
  });
});

describe('fake gateway: profile photo write (same contract, no network)', () => {
  it('stores one photo per user; repeating the same version does not duplicate', async () => {
    const book = new FakeUserPhotoBook();
    const gateway: SankhyaProfilePhotoPort = new FakeGateway({ userPhotos: book });
    await gateway.writeUserPhoto(request());
    await gateway.writeUserPhoto(request());
    expect(book.photos.size).toBe(1);
    expect(book.writes).toHaveLength(2);
  });

  it('validates like the real adapter', async () => {
    const gateway = new FakeGateway({ userPhotos: new FakeUserPhotoBook() });
    const error = await failureOf(gateway.writeUserPhoto(request({ image: new Uint8Array([9, 9, 9, 9]) })));
    expect((error as SankhyaGatewayError).code).toBe('user_photo_invalid_image');
  });

  it('plays scripted failures', async () => {
    const book = new FakeUserPhotoBook();
    book.script({ kind: 'error', error: new SankhyaGatewayError('unavailable', { code: 'down', message: 'down' }) });
    const gateway = new FakeGateway({ userPhotos: book });
    expect(((await failureOf(gateway.writeUserPhoto(request()))) as SankhyaGatewayError).retryable).toBe(true);
    await gateway.writeUserPhoto(request());
    expect(book.photos.size).toBe(1);
  });
});
