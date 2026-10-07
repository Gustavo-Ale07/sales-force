import { parseVerifierEnv } from './verifier/env.js';
import { SankhyaLoginVerification } from './verifier/sankhya-login.js';
import { createVerifierServer } from './verifier/server.js';
import { createLogger } from './observability/logger.js';
import { installProcessGuards, runMain } from './process.js';

/**
 * Internal identity verifier entry point (STACK-2 option C, STACK-2a). It validates its own environment (fail
 * closed) and listens on the internal network. `disabled` answers a uniform denial; `live` verifies the user's own
 * Sankhya login against the SANDBOX (`verifier/sankhya-login.ts`). It has no database access, holds no Sankhya
 * integration credential, and must never be published or placed on the edge network.
 */
runMain('verifier', async () => {
  const config = parseVerifierEnv(process.env);
  const logger = createLogger({ level: config.logLevel, service: 'verifier' });
  const verification =
    config.mode === 'live' && config.sankhya !== null
      ? new SankhyaLoginVerification({
          origin: config.sankhya.origin,
          onOutcome: (outcome) => logger.info({ outcome }, 'sankhya login verification'),
        })
      : undefined;
  const server = createVerifierServer({ config, logger, ...(verification === undefined ? {} : { verification }) });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  installProcessGuards(
    logger,
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  logger.info({ mode: config.mode, host: config.host, port: config.port, nodeEnv: config.nodeEnv }, 'verifier ready');
});
