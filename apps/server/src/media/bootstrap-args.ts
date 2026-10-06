export interface BootstrapArgs {
  limit?: number;
  /** Targeted run: exactly these product codes (CODPROD), deduplicated, in the order given. */
  productCodes?: number[];
  concurrency?: number;
  dryRun: boolean;
  forceVerify: boolean;
  prune: boolean;
  allowLargePrune: boolean;
}

export class BootstrapArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapArgsError';
  }
}

export const BOOTSTRAP_USAGE =
  'Usage: product-media-bootstrap [--limit N | --codprod CODE[,CODE...]] [--concurrency 1..16] [--dry-run] [--force-verify] [--prune [--allow-large-prune]]\n' +
  '  --codprod CODE[,CODE...] (repeatable, at most 50 codes) processes exactly those products and nothing else: positive integers only; a code the scoped\n' +
  '  listing does not return is reported as missing. It cannot be combined with --limit or --prune; --dry-run and --force-verify apply to it.\n' +
  '  --prune needs the complete listing from a live gateway and cannot be combined with --limit.\n' +
  '  A prune that would remove more than half of the stored photos needs --allow-large-prune; an empty listing is never pruned.';

function positiveInteger(name: string, raw: string | undefined, max: number): number {
  if (raw === undefined || !/^\d+$/.test(raw)) throw new BootstrapArgsError(`${name} needs a positive integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new BootstrapArgsError(`${name} must be between 1 and ${max}.`);
  return value;
}

/** Same bound as the service (MAX_TARGETED_CODES); kept literal so the parser stays free of service imports. */
const MAX_CODPROD = 50;

function productCodes(raw: string | undefined): number[] {
  if (raw === undefined || raw.length === 0) throw new BootstrapArgsError('--codprod needs one or more positive integers (e.g. --codprod 15 or --codprod 15,16).');
  return raw.split(',').map((part) => positiveInteger('--codprod', part, Number.MAX_SAFE_INTEGER));
}

/** Pure parser of the bootstrap command line (everything after the script name). */
export function parseBootstrapArgs(argv: readonly string[]): BootstrapArgs {
  const args: BootstrapArgs = { dryRun: false, forceVerify: false, prune: false, allowLargePrune: false };
  const list = argv.filter((arg, index) => !(arg === '--' && index === 0));
  for (let index = 0; index < list.length; index++) {
    const token = list[index] as string;
    const [flag, inline] = token.startsWith('--') && token.includes('=') ? [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)] : [token, undefined];
    const value = (): string | undefined => inline ?? list[++index];
    switch (flag) {
      case '--limit':
        args.limit = positiveInteger('--limit', value(), Number.MAX_SAFE_INTEGER);
        break;
      case '--codprod': {
        const codes = [...(args.productCodes ?? []), ...productCodes(value())];
        args.productCodes = [...new Set(codes)];
        if (args.productCodes.length > MAX_CODPROD) throw new BootstrapArgsError(`--codprod accepts at most ${MAX_CODPROD} distinct codes.`);
        break;
      }
      case '--concurrency':
        args.concurrency = positiveInteger('--concurrency', value(), 16);
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--force-verify':
        args.forceVerify = true;
        break;
      case '--prune':
        args.prune = true;
        break;
      case '--allow-large-prune':
        args.allowLargePrune = true;
        break;
      default:
        throw new BootstrapArgsError(`Unknown argument: ${flag}.`);
    }
  }
  if (args.productCodes !== undefined && args.limit !== undefined) throw new BootstrapArgsError('--codprod cannot be combined with --limit.');
  if (args.productCodes !== undefined && args.prune) throw new BootstrapArgsError('--codprod cannot be combined with --prune (a partial run never prunes).');
  if (args.prune && args.limit !== undefined) throw new BootstrapArgsError('--prune cannot be combined with --limit.');
  if (args.allowLargePrune && !args.prune) throw new BootstrapArgsError('--allow-large-prune only applies together with --prune.');
  return args;
}
