import { describe, expect, it } from 'vitest';
import { OrderEntryConfigurationSchema } from '@salesforce/contracts';
import { baseConfiguration } from '../helpers/overlay-base.js';
import { toOrderEntryConfiguration } from '../../src/configuration/configuration-summary.js';

/** Owner ruling 2026-11-13: the device learns from the configuration whether customer creation is released. */
describe('order-entry configuration: customerCreationEnabled', () => {
  const build = (customerCreationEnabled?: boolean) =>
    toOrderEntryConfiguration(baseConfiguration(), null, undefined, customerCreationEnabled);

  it('reports creation released when the API switch is on', () => {
    const body = build(true);
    expect(body.general.customerCreationEnabled).toBe(true);
    expect(OrderEntryConfigurationSchema.safeParse(body).success).toBe(true);
  });

  it('reports creation not released when the API switch is off', () => {
    expect(build(false).general.customerCreationEnabled).toBe(false);
  });

  it('omits the field when the state is unknown (additive, optional)', () => {
    expect('customerCreationEnabled' in build().general).toBe(false);
  });
});
