import { createDb } from '@salesforce/db';
import { parseApiEnv } from './config/api-env.js';
import { AuditService } from './iam/audit.service.js';
import { ServerCodeRepository } from './iam/server-code.repository.js';
import { ServerCodeService } from './iam/server-code.service.js';
import { SessionRepository } from './iam/session.repository.js';
import { ThrottleRepository } from './iam/throttle.repository.js';
import { systemClock } from './platform/tokens.js';
import { runMain } from './process.js';

const USAGE = 'Usage: server-code-cli.js <show-hash|rotate>';

/**
 * Operator command for the server code, run inside the API container over SSH (`deploy/scripts/server-code.sh`). There is no HTTP
 * route and no screen for it (owner ruling 2026-11-27).
 *
 * - `show-hash`: says whether a code is active and prints only a short hash prefix and the date. NEVER the code.
 * - `rotate`: generates a new 256-bit secret, replaces the stored hash, revokes every session, audits `config.server_code_rotated`
 *   (actor `cli`) and prints the complete code `sf1.<...>` ONCE on standard output (messages go to standard error). The address inside
 *   the code comes from `SF_PUBLIC_API_URL`.
 */
runMain('server-code-cli', async () => {
  const command = process.argv[2];
  if (command !== 'show-hash' && command !== 'rotate') {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const env = parseApiEnv(process.env);
  const db = createDb(env.DATABASE_URL.reveal(), { max: 2, applicationName: 'salesforce-server-code-cli' });
  try {
    const service = new ServerCodeService(
      new ServerCodeRepository(db.db),
      new SessionRepository(db.db),
      new AuditService(db.db, systemClock),
      new ThrottleRepository(db.db),
      systemClock,
    );
    if (command === 'show-hash') {
      const active = await service.describeActive();
      if (active === null) {
        process.stdout.write('No active server code. Run `rotate` to generate the first one.\n');
        process.exitCode = 1;
        return;
      }
      process.stdout.write(`Active server code: hash ${active.hashPrefix}..., generated at ${active.createdAt.toISOString()}\n`);
      return;
    }
    if (env.SF_PUBLIC_API_URL === undefined || env.SF_PUBLIC_API_URL === '') {
      throw new Error('SF_PUBLIC_API_URL is required: the public origin of this API (it goes inside the code).');
    }
    const { code, revokedSessions } = await service.rotate(env.SF_PUBLIC_API_URL);
    process.stderr.write(`New server code generated; ${revokedSessions} session(s) revoked; the old code no longer works. Shown only now:\n`);
    process.stdout.write(`${code}\n`);
  } finally {
    await db.close();
  }
});
