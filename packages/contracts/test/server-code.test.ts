import { describe, expect, it } from 'vitest';
import { decodeServerCode, encodeServerCode, isServerCodeSecret } from '../src/server-code.js';

const SECRET = 'AbC-_9'.repeat(7) + 'x';

describe('server code', () => {
  it('round-trips the API address and the secret', () => {
    const code = encodeServerCode({ a: 'https://api.exemplo.test', k: SECRET });
    expect(code.startsWith('sf1.')).toBe(true);
    expect(decodeServerCode(code)).toEqual({ a: 'https://api.exemplo.test', k: SECRET });
  });

  it('keeps a port and a path prefix', () => {
    const payload = { a: 'http://10.0.2.2:3000/base', k: SECRET };
    expect(decodeServerCode(encodeServerCode(payload))).toEqual(payload);
  });

  it('returns null for anything that is not a well-formed code', () => {
    expect(decodeServerCode('')).toBeNull();
    expect(decodeServerCode('sf1.')).toBeNull();
    expect(decodeServerCode('sf2.eyJhIjoiaHR0cHM6Ly94LnRlc3QifQ')).toBeNull();
    expect(decodeServerCode('sf1.%%%')).toBeNull();
    expect(decodeServerCode(`sf1.${Buffer.from('{"a":"ftp://x.test","k":"' + SECRET + '"}').toString('base64url')}`)).toBeNull();
    expect(decodeServerCode(`sf1.${Buffer.from('{"a":"https://x.test","k":"short"}').toString('base64url')}`)).toBeNull();
  });

  it('recognizes only 43-character base64url secrets', () => {
    expect(isServerCodeSecret(SECRET)).toBe(true);
    expect(isServerCodeSecret('short')).toBe(false);
    expect(isServerCodeSecret(`${SECRET}=`)).toBe(false);
  });
});
