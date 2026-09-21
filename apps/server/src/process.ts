import type { DbHandle } from '@salesforce/db';
import type { Logger } from './observability/logger.js';

/**
 * Entry-point plumbing shared by the API, the Worker and the CLI scripts. Fatal start-up errors are
 * written to stderr as text (the logger may not exist yet); they are secret-free by construction:
 * environment errors name variables only, never values.
 */
export function runMain(name: string, main: () => Promise<void>): void {
  main().catch((error: unknown) => {
    const lines = [`${name}: failed to start`];
    for (let current: unknown = error, depth = 0; current instanceof Error && depth < 3; depth += 1) {
      lines.push(depth === 0 ? current.message : `caused by: ${current.message}`);
      current = current.cause;
    }
    process.stderr.write(`${lines.join('\n')}\n`);
    process.exitCode = 1;
  });
}

/** Logs pool-level errors (an idle client dropped by the server) instead of crashing the process. */
export function logPoolErrors(handle: DbHandle, logger: Logger): void {
  handle.pool.on('error', (error) => logger.error({ err: error }, 'database pool error'));
}

/**
 * Runs `shutdown` once on SIGTERM/SIGINT and exits; a second signal forces an immediate exit. An
 * unexpected exception or rejection is logged as fatal and the process exits so the supervisor
 * restarts it (expected integration failures are handled where they occur and never reach here).
 */
export function installProcessGuards(logger: Logger, shutdown: () => Promise<void>): void {
  let stopping = false;
  const onSignal = (signal: string) => {
    if (stopping) {
      logger.warn({ signal }, 'second signal received; forcing exit');
      process.exit(1);
    }
    stopping = true;
    logger.info({ signal }, 'shutdown requested');
    shutdown().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, 'shutdown failed');
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled rejection');
    process.exit(1);
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    process.exit(1);
  });
}
