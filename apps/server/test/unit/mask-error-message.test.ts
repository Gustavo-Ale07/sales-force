import { describe, expect, it } from 'vitest';
import { sankhyaMaskTargets } from '../../src/config/worker-env.js';
import { maskErrorMessage } from '../../src/observability/mask-error-message.js';

/** D-Q: nothing sensitive survives in text stored in sync_state / integration_outbox / dry-run records. */
const HOST = 'api.sandbox.sankhya.example';
const SECRET = 'cs_live_9f8e7d6c5b4a';
const targets = { hosts: [HOST], secrets: [SECRET] };

const LEAKY = [
  `Authorization: Bearer abc123.def456.ghi789 rejected`,
  `Authorization: Basic c2VjcmV0YmFzaWM6aHVudGVyMg== rejected`,
  `authorization=Digest sometoken123 realm`,
  `request failed with header authorization=Bearer sometoken123`,
  `X-Token: 9a8b7c6d5e4f3a2b1c0d`,
  `{"access_token":"tok_abcdef123456","expires_in":300}`,
  `client_secret=${SECRET}&grant_type=client_credentials`,
  `password=hunter2hunter2 invalid`,
  `senha: "minhaSenha123"`,
  `POST https://user:pass@${HOST}/gateway/v1/mge/service.sbr failed`,
  `connect ECONNREFUSED https://${HOST}/mge/service.sbr?token=zzz`,
  `getaddrinfo ENOTFOUND ${HOST}`,
  `secret leaked ${SECRET} in body`,
  `postgres://sf:dbpass@db.internal:5432/sf timed out`,
  `jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl end`,
  `user:pass@${HOST} unreachable`,
];

const FORBIDDEN = [/bearer\s+[a-z0-9]/i, /c2VjcmV0YmFzaWM6/, /basic\s+[a-z0-9]/i, /abc123|sometoken123|9a8b7c6d5e4f3a2b1c0d|tok_abcdef|hunter2|minhaSenha|dbpass|user:pass|c2lnbmF0dXJl/, /token=zzz/];

describe('maskErrorMessage (D-Q)', () => {
  it.each(LEAKY)('masks %s', (text) => {
    const masked = maskErrorMessage(text, targets);
    expect(masked).not.toContain(HOST);
    expect(masked).not.toContain(SECRET);
    for (const pattern of FORBIDDEN) expect(masked).not.toMatch(pattern);
  });

  it('keeps the class, the code and the short human text', () => {
    expect(maskErrorMessage('SANKHYA_VALIDATION: Cliente 1001 sem tabela de preço', targets)).toBe('SANKHYA_VALIDATION: Cliente 1001 sem tabela de preço');
    expect(maskErrorMessage('TransientJobError (ECONNRESET): retry', targets)).toBe('TransientJobError (ECONNRESET): retry');
  });

  it('is deterministic and idempotent', () => {
    const once = maskErrorMessage(LEAKY.join(' | '), targets);
    expect(maskErrorMessage(once, targets)).toBe(once);
  });

  it('ignores secrets that are too short to be real values', () => {
    expect(maskErrorMessage('ok abc done', { secrets: ['abc'] })).toBe('ok abc done');
  });
});

describe('sankhyaMaskTargets', () => {
  it('derives the hosts from the base URL and the allow-list, and the literal secrets', () => {
    const t = sankhyaMaskTargets({
      SANKHYA_BASE_URL: `https://${HOST}/gateway`,
      SANKHYA_ALLOWED_HOSTS: 'a.example, b.example',
      SANKHYA_CLIENT_SECRET: SECRET,
    });
    expect(t.hosts).toEqual([HOST, 'a.example', 'b.example']);
    expect(t.secrets).toEqual([SECRET]);
  });

  it('is empty when nothing is configured', () => {
    expect(sankhyaMaskTargets({})).toEqual({ hosts: [], secrets: [] });
  });
});
