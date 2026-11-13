import { z } from 'zod';
import type { CustomerPayloadRetention } from '../../integration/customer-payload-retention.js';
import type { CustomerDeliveryService } from '../../integration/customer-delivery.service.js';
import type { JobContext, JobHandler } from '../job-contract.js';
import { QUEUE_NAMES } from '../queues.js';

/**
 * `integration.customer.deliver`: one sweep of the customer delivery (D-AR). Registered only when customer writing is
 * on. The service handles each outbox row on its own and records every outcome in `integration_outbox`, so the job
 * never needs pg-boss retries.
 */
export class CustomerDeliveryJob implements JobHandler<Record<string, never>> {
  readonly queue = QUEUE_NAMES.integrationCustomerDeliver;
  readonly payload = z.object({});

  constructor(private readonly service: CustomerDeliveryService) {}

  async handle(_payload: Record<string, never>, context: JobContext): Promise<void> {
    await this.service.runDue(context.signal === undefined ? {} : { signal: context.signal });
  }
}

/** `integration.customer.payload-purge`: clears personal data of finished customer commands after 30 days (M-5). */
export class CustomerPayloadPurgeJob implements JobHandler<Record<string, never>> {
  readonly queue = QUEUE_NAMES.integrationCustomerPayloadPurge;
  readonly payload = z.object({});

  constructor(private readonly retention: CustomerPayloadRetention) {}

  async handle(): Promise<void> {
    await this.retention.purge();
  }
}
