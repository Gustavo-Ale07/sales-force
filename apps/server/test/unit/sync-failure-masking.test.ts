import { SankhyaGatewayError } from '@salesforce/sankhya';
import { afterEach, describe, expect, it } from 'vitest';
import { setMaskTargets } from '../../src/observability/mask-error-message.js';
import { describeSyncFailure } from '../../src/sync/failure.js';
import { PermanentJobError } from '../../src/worker/job-contract.js';

/** D-Q: the text that reaches sync_state.last_error_message is masked using the configured Sankhya host. */
const HOST = 'sandbox.sankhya.example';

afterEach(() => setMaskTargets({}));

describe('describeSyncFailure masking (D-Q)', () => {
  it('removes the Sankhya host, the token and credentials from a gateway error', () => {
    setMaskTargets({ hosts: [HOST] });
    const failure = describeSyncFailure(
      new SankhyaGatewayError('unavailable', { code: 'http_503', message: `GET ${HOST}/x failed; Authorization: Bearer tok123456 X-Token: abcdef123456` }),
    );
    expect(failure.errorClass).toBe('unavailable');
    expect(failure.errorCode).toBe('http_503');
    expect(failure.message).not.toContain(HOST);
    expect(failure.message).not.toMatch(/tok123456|abcdef123456/);
    expect(failure.message.startsWith('http_503:')).toBe(true);
  });

  it('masks a job error message too', () => {
    const failure = describeSyncFailure(new PermanentJobError('bad password=hunter2hunter2 at https://u:p@x.example/a'));
    expect(failure.message).not.toMatch(/hunter2|u:p@|x\.example/);
  });
});
