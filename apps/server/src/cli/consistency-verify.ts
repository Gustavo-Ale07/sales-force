import { createDb } from '@salesforce/db';
import { loadWorkerConfig } from '../config/worker-env.js';
import { DEFAULT_SAMPLE_LIMIT, ConsistencyVerifier, type ConsistencyVerifierDeps } from '../consistency/consistency-verifier.js';
import { CONSISTENCY_TYPES, isConsistencyType, type ConsistencyType } from '../consistency/types.js';
import { createLogger } from '../observability/logger.js';
import { runMain } from '../process.js';
import { loadCurrentReadScope } from '../sync/mirror-scope.js';

/**
 * Operator tool, READ-ONLY: compares what Sankhya returns now with the Force mirror, per synchronized type.
 * Runs inside the worker container (it holds the Sankhya credentials and the same scope configuration as the mirror jobs):
 *   node dist/cli/consistency-verify.js [--types customers,products] [--limit 50] [--json]
 * Prints counts and identifiers only (no personal data). Exit code: 0 consistent, 1 differences or incomplete, 2 bad arguments.
 */
function parseArgs(argv: readonly string[]): { types?: ConsistencyType[]; limit: number; json: boolean } | string {
  let types: ConsistencyType[] | undefined;
  let limit = DEFAULT_SAMPLE_LIMIT;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') json = true;
    else if (arg === '--limit') {
      limit = Number(argv[(i += 1)]);
      if (!Number.isInteger(limit) || limit < 0) return '--limit needs a non-negative integer';
    } else if (arg === '--types') {
      const names = (argv[(i += 1)] ?? '').split(',').filter((n) => n !== '');
      const bad = names.filter((n) => !isConsistencyType(n));
      if (names.length === 0 || bad.length > 0) return `--types accepts: ${CONSISTENCY_TYPES.join(', ')}`;
      types = names as ConsistencyType[];
    } else return `unknown argument: ${String(arg)}`;
  }
  return { ...(types === undefined ? {} : { types }), limit, json };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === 'string') {
    process.stderr.write(`${args}\n`);
    process.exitCode = 2;
    return;
  }
  const config = loadWorkerConfig(process.env);
  const logger = createLogger({ level: config.env.LOG_LEVEL, service: 'worker' });
  const handle = createDb(config.env.DATABASE_URL.reveal(), { max: 2, applicationName: 'consistency-verify' });
  try {
    const verifier = new ConsistencyVerifier({
      db: handle,
      gateway: config.gateway as ConsistencyVerifierDeps['gateway'],
      // Read methods only (the verifier's type exposes nothing else); the origin lookup runs only with a live dedicated field.
      orders: {
        gateway: config.gateway,
        ...(config.orderWrite.mode === 'live' && config.orderWrite.originField !== null ? { originField: config.orderWrite.originField } : {}),
      },
      logger,
      readScope: () => loadCurrentReadScope(handle.db),
    });
    const report = await verifier.run({ ...(args.types === undefined ? {} : { types: args.types }), sampleLimit: args.limit });
    if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      process.stdout.write(`gateway=${report.gatewayMode} started=${report.startedAt}\n`);
      for (const t of report.types) {
        process.stdout.write(
          `${t.type.padEnd(20)} ${t.status.padEnd(20)} source=${t.sourceCount ?? '-'} force=${t.mirrorCount ?? '-'} missing=${t.missing} extra=${t.extra} divergent=${t.divergent}${t.detail === undefined ? '' : ` (${t.detail})`}\n`,
        );
        for (const kind of ['missing', 'extra', 'divergent'] as const) {
          if (t.samples[kind].length > 0) process.stdout.write(`    ${kind}: ${t.samples[kind].join(', ')}${t[kind] > t.samples[kind].length ? ` ... +${t[kind] - t.samples[kind].length}` : ''}\n`);
        }
      }
      process.stdout.write(`totals missing=${report.totals.missing} extra=${report.totals.extra} divergent=${report.totals.divergent} consistent=${report.consistent} incomplete=${report.incomplete}\n`);
    }
    process.exitCode = report.consistent ? 0 : 1;
  } finally {
    await handle.close();
  }
}

runMain('consistency-verify', main);
