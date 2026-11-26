import { z } from 'zod';
import type { NotificationSweepService } from '../../notifications/notification-sweep.service.js';
import type { JobHandler } from '../job-contract.js';
import { QUEUE_NAMES } from '../queues.js';

/** `notifications.sweep`: events -> notifications, task reminders, push dispatch. Idempotent; the unique dedupe key is the guard. */
export class NotificationSweepJob implements JobHandler<Record<string, never>> {
  readonly queue = QUEUE_NAMES.notificationsSweep;
  readonly payload = z.object({});

  constructor(private readonly service: NotificationSweepService) {}

  async handle(): Promise<void> {
    await this.service.run();
  }
}
