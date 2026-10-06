import { describe, expect, it } from 'vitest';
import { BootstrapArgsError, parseBootstrapArgs } from '../../src/media/bootstrap-args.js';

describe('product-media-bootstrap arguments', () => {
  it('defaults to a real, complete, non-forced run', () => {
    expect(parseBootstrapArgs([])).toEqual({ dryRun: false, forceVerify: false, prune: false, allowLargePrune: false });
  });

  it('ignores a leading -- separator and reads every option', () => {
    expect(parseBootstrapArgs(['--', '--limit', '10', '--concurrency=3', '--dry-run', '--force-verify'])).toEqual({
      limit: 10,
      concurrency: 3,
      dryRun: true,
      forceVerify: true,
      prune: false,
      allowLargePrune: false,
    });
  });

  it('--allow-large-prune only makes sense together with --prune', () => {
    expect(parseBootstrapArgs(['--prune', '--allow-large-prune'])).toMatchObject({ prune: true, allowLargePrune: true });
    expect(() => parseBootstrapArgs(['--allow-large-prune'])).toThrow(BootstrapArgsError);
  });

  it('accepts --prune alone and refuses it with --limit', () => {
    expect(parseBootstrapArgs(['--prune']).prune).toBe(true);
    expect(() => parseBootstrapArgs(['--prune', '--limit', '5'])).toThrow(BootstrapArgsError);
  });

  it.each([
    [['--limit']],
    [['--limit', '0']],
    [['--limit', 'abc']],
    [['--limit', '1.5']],
    [['--concurrency', '17']],
    [['--concurrency=0']],
    [['--unknown']],
    [['positional']],
  ])('refuses %j', (argv) => {
    expect(() => parseBootstrapArgs(argv)).toThrow(BootstrapArgsError);
  });
});

describe('product-media-bootstrap --codprod', () => {
  it('accepts one code, a comma list and repeated flags, deduplicated in the order given', () => {
    expect(parseBootstrapArgs(['--codprod', '15']).productCodes).toEqual([15]);
    expect(parseBootstrapArgs(['--codprod=15,16']).productCodes).toEqual([15, 16]);
    expect(parseBootstrapArgs(['--codprod', '16', '--codprod', '15,16', '--codprod=7']).productCodes).toEqual([16, 15, 7]);
  });

  it('works with --dry-run, --force-verify and --concurrency', () => {
    expect(parseBootstrapArgs(['--codprod', '15', '--dry-run', '--force-verify', '--concurrency', '2'])).toEqual({
      productCodes: [15],
      concurrency: 2,
      dryRun: true,
      forceVerify: true,
      prune: false,
      allowLargePrune: false,
    });
  });

  it('is not set unless asked for, so --limit keeps its meaning', () => {
    expect(parseBootstrapArgs(['--limit', '5']).productCodes).toBeUndefined();
    expect(parseBootstrapArgs(['--limit', '5']).limit).toBe(5);
  });

  it('cannot be combined with --limit or --prune, in either order', () => {
    expect(() => parseBootstrapArgs(['--codprod', '15', '--limit', '5'])).toThrow(/--limit/);
    expect(() => parseBootstrapArgs(['--limit', '5', '--codprod', '15'])).toThrow(/--limit/);
    expect(() => parseBootstrapArgs(['--codprod', '15', '--prune'])).toThrow(/--prune/);
  });

  it('accepts exactly 50 distinct codes and refuses 51', () => {
    const list = (n: number): string => Array.from({ length: n }, (_, i) => i + 1).join(',');
    expect(parseBootstrapArgs(['--codprod', list(50)]).productCodes).toHaveLength(50);
    expect(() => parseBootstrapArgs(['--codprod', list(51)])).toThrow(/at most 50/);
  });

  it.each([
    [['--codprod']],
    [['--codprod', '']],
    [['--codprod', '0']],
    [['--codprod', '-1']],
    [['--codprod', '1.5']],
    [['--codprod', '1e3']],
    [['--codprod', '15,']],
    [['--codprod', ',15']],
    [['--codprod', '15,,16']],
    [['--codprod', '15 16']],
    [['--codprod', 'abc']],
    [['--codprod', '15; DROP TABLE product']],
    [['--codprod', "15' OR '1'='1"]],
    [['--codprod', '9007199254740993']],
    [['--codprod', '--dry-run']],
  ])('refuses %j (positive integers only)', (argv) => {
    expect(() => parseBootstrapArgs(argv)).toThrow(BootstrapArgsError);
  });
});
