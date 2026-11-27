import { z } from 'zod';
import { named } from './primitives.js';

/**
 * App parameters read from the Force configuration (edited on the site, "Parâmetros"). Replaces the former per-device payload:
 * there is no device approval any more (owner ruling 2026-11-27, server code instead).
 */
export const SessionAppConfigSchema = named(
  'SessionAppConfig',
  z.object({
    /** Days the app may stay without a synchronization. */
    offlineMaxDays: z.number().int().min(1).max(60),
    /** Price table of a customer without one. */
    defaultPriceTableCode: z.number().int().min(0).optional(),
  }),
);
export type SessionAppConfig = z.infer<typeof SessionAppConfigSchema>;
