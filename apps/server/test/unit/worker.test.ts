import { SankhyaGatewayError } from '@salesforce/sankhya';
import type { Job } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../../src/observability/logger.js';
import { currentLogContext } from '../../src/observability/request-context.js';
import { HEARTBEAT_STALE_AFTER_MS } from '../../src/platform/worker-heartbeat.js';
import { WorkerHealth } from '../../src/worker/health.js';
import { PermanentJobError, TransientJobError, type JobHandler } from '../../src/worker/job-contract.js';
import { createBatchHandler } from '../../src/worker/job-runner.js';
import { QUEUE_NAMES, QUEUE_REGISTRY } from '../../src/worker/queues.js';
import { classifyJobFailure } from '../../src/worker/retry.js';

describe('failure classification', () => {
  it('retries only transient failures', () => {
    expect(classifyJobFailure(new TransientJobError('down'))).toMatchObject({ retry: true, errorClass: 'transient' });
    expect(classifyJobFailure(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toMatchObject({ retry: true });
    expect(classifyJobFailure(Object.assign(new Error('x'), { code: '57P01' }))).toMatchObject({ retry: true });
    expect(classifyJobFailure(Object.assign(new Error('x'), { code: '40001' }))).toMatchObject({ retry: true });
  });

  it('never retries permanent, unclassified or non-transient database failures', () => {
    expect(classifyJobFailure(new PermanentJobError('bad'))).toEqual({ retry: false, errorClass: 'permanent' });
    expect(classifyJobFailure(new Error('surprise'))).toEqual({ retry: false, errorClass: 'unclassified' });
    expect(classifyJobFailure(Object.assign(new Error('x'), { code: '23505' }))).toMatchObject({ retry: false });
    expect(classifyJobFailure('a string')).toMatchObject({ retry: false });
  });

  it('follows the Sankhya error taxonomy', () => {
    const cases: [ConstructorParameters<typeof SankhyaGatewayError>[0], boolean][] = [
      ['unavailable', true],
      ['rate_limit', true],
      ['temporary', true],
      ['auth', false],
      ['validation', false],
      ['permanent', false],
    ];
    for (const [kind, retry] of cases) {
      const result = classifyJobFailure(new SankhyaGatewayError(kind, { code: 'x', message: 'm' }));
      expect(result.retry, kind).toBe(retry);
      expect(result.errorClass).toBe(kind);
    }
  });
});

describe('queue registry', () => {
  it('declares the dead-letter queue before any queue that references it', () => {
    const names = QUEUE_REGISTRY.map((spec) => spec.name);
    expect(names[0]).toBe(QUEUE_NAMES.deadLetter);
    for (const spec of QUEUE_REGISTRY) {
      const target = spec.options.deadLetter;
      if (target !== undefined) expect(names.indexOf(target)).toBeLessThan(names.indexOf(spec.name));
    }
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('batch handler', () => {
  const logger = createLogger({ level: 'silent', service: 'test' });
  const now = () => new Date('2026-09-21T12:00:00.000Z');
  const job = (id: string, data: object): Job<object> => ({ id, name: 'test.queue', data }) as Job<object>;

  function handlerOf(handle: JobHandler<{ n: number }>['handle']): JobHandler<{ n: number }> {
    return { queue: 'test.queue', payload: z.object({ n: z.number() }), handle };
  }

  it('settles each job of a batch independently', async () => {
    const seen: unknown[] = [];
    const run = createBatchHandler(
      handlerOf((payload, context) => {
        seen.push({ ctx: currentLogContext(), jobId: context.jobId });
        if (payload.n === 2) return Promise.reject(new PermanentJobError('cannot succeed'));
        if (payload.n === 3) return Promise.reject(new TransientJobError('try later'));
        if (payload.n === 4) return Promise.reject(new Error('token=abc must not be stored'));
        return Promise.resolve();
      }),
      { logger, now },
    );
    const results = await run([
      job('a', { n: 1 }),
      job('b', { n: 2 }),
      job('c', { n: 3 }),
      job('d', { n: 4 }),
      job('e', { n: 'x' }),
    ]);
    expect(results.map((result) => [result.id, result.status])).toEqual([
      ['a', 'completed'],
      ['b', 'deadletter'],
      ['c', 'failed'],
      ['d', 'deadletter'],
      ['e', 'deadletter'],
    ]);
    expect(results[1]).toMatchObject({ output: { errorClass: 'permanent', message: 'cannot succeed' } });
    expect(results[2]).toMatchObject({ output: { errorClass: 'transient' } });
    // Unknown errors are classified but their message is never stored.
    expect(JSON.stringify(results[3])).not.toContain('token=abc');
    expect(results[4]).toMatchObject({ output: { errorClass: 'invalid_payload' } });
    expect(seen[0]).toMatchObject({ ctx: { jobId: 'a', queue: 'test.queue' } });
  });

  it('does not run the handler for an invalid payload and never throws', async () => {
    const handle = vi.fn(() => Promise.resolve());
    const run = createBatchHandler(handlerOf(handle), { logger, now });
    await expect(run([job('x', { n: 'nope' })])).resolves.toHaveLength(1);
    expect(handle).not.toHaveBeenCalled();
  });
});

describe('worker health', () => {
  it('is starting, ok, stale and stopping', () => {
    let clock = new Date('2026-09-21T12:00:00.000Z');
    const health = new WorkerHealth(() => clock);
    expect(health.snapshot()).toMatchObject({ healthy: false, state: 'starting' });

    health.markStarted();
    expect(health.snapshot()).toMatchObject({ healthy: true, state: 'ok', lastHeartbeatAt: null });

    health.recordBeat(clock);
    clock = new Date(clock.getTime() + HEARTBEAT_STALE_AFTER_MS + 1);
    expect(health.snapshot()).toMatchObject({ healthy: false, state: 'stale' });

    health.recordBeat(clock);
    expect(health.snapshot()).toMatchObject({ healthy: true, state: 'ok' });

    health.markStopping();
    expect(health.snapshot()).toMatchObject({ healthy: false, state: 'stopping' });
  });
});
