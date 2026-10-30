import { z } from 'zod';
import type { OrderDeliveryService } from '../../integration/order-delivery.service.js';
import type { JobContext, JobHandler } from '../job-contract.js';
import { QUEUE_NAMES } from '../queues.js';

/**
 * `integration.order.deliver`: one sweep of the order delivery (SNK-7). Registered only when the order-write
 * switch is on. The service handles each outbox row on its own (a failing order never stops the sweep) and
 * records every outcome in `integration_outbox`, so the job itself never needs pg-boss retries.
 */
export class OrderDeliveryJob implements JobHandler<Record<string, never>> {
  readonly queue = QUEUE_NAMES.integrationOrderDeliver;
  readonly payload = z.object({});

  constructor(private readonly service: OrderDeliveryService) {}

  async handle(_payload: Record<string, never>, context: JobContext): Promise<void> {
    await this.service.runDue(context.signal === undefined ? {} : { signal: context.signal });
  }
}

/** `integration.order.dry-run-purge`: removes dry-run records older than the retention window (D-6, 30 days). */
export class OrderDryRunPurgeJob implements JobHandler<Record<string, never>> {
  readonly queue = QUEUE_NAMES.integrationOrderDryRunPurge;
  readonly payload = z.object({});

  constructor(private readonly service: OrderDeliveryService) {}

  async handle(): Promise<void> {
    await this.service.purgeDryRuns();
  }
}
