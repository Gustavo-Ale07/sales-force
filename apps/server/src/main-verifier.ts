import { parseVerifierEnv } from './verifier/env.js';
import { createVerifierServer } from './verifier/server.js';
import { createLogger } from './observability/logger.js';
import { installProcessGuards, runMain } from './process.js';

/**
 * Internal identity verifier entry point (STACK-2 option C). STRUCTURE ONLY: it validates its own
 * environment (fail closed), listens on the internal network and answers a uniform denial. The real ERP
 * adapter does not exist and `VERIFIER_MODE=live` is refused at boot. It has no database access, reads no
 * Sankhya setting, and must never be published or placed on the edge network.
 */
runMain('verifier', async () => {
  const config = parseVerifierEnv(process.env);
  const logger = createLogger({ level: config.logLevel, service: 'verifier' });
  const server = createVerifierServer({ config, logger });

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
