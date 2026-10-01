import { describe, expect, it } from 'vitest';
import { DatasetIdentitySchema, OrderEntryConfigurationSchema } from '../src/index.js';

const SLICE = {
  general: { enabled: true },
  sales: {
    defaultNegotiationTypeCode: 2,
    negotiationTypes: [{ code: 2, label: 'À vista' }],
    orderBehavior: { allowDraftWithoutPrice: false },
  },
  products: { productWithoutPrice: { orderable: false } },
};

describe('DatasetIdentitySchema', () => {
  it('accepts an environment slug and a dataset id slug', () => {
    const value = { environment: 'sandbox', datasetId: 'plac-sandbox-real-1' };
    expect(DatasetIdentitySchema.parse(value)).toEqual(value);
  });

  it.each([
    { environment: '', datasetId: 'plac-sandbox-real-1' },
    { environment: 'Sandbox', datasetId: 'plac-sandbox-real-1' },
    { environment: 'a'.repeat(33), datasetId: 'plac-sandbox-real-1' },
    { environment: 'sandbox', datasetId: 'ab' },
    { environment: 'sandbox', datasetId: '-leading-dash' },
    { environment: 'sandbox', datasetId: 'has space' },
    { environment: 'sandbox', datasetId: 'a'.repeat(65) },
    { environment: 'sandbox' },
    { environment: 'sandbox', datasetId: 'plac-sandbox-real-1', extra: 'x' },
  ])('rejects %j', (value) => {
    expect(DatasetIdentitySchema.safeParse(value).success).toBe(false);
  });
});

describe('OrderEntryConfigurationSchema dataset', () => {
  it('carries the identity or an explicit null', () => {
    const identity = { environment: 'sandbox', datasetId: 'plac-sandbox-real-1' };
    expect(OrderEntryConfigurationSchema.parse({ ...SLICE, dataset: identity }).dataset).toEqual(identity);
    expect(OrderEntryConfigurationSchema.parse({ ...SLICE, dataset: null }).dataset).toBeNull();
  });

  it('requires the field (undefined is not null)', () => {
    expect(OrderEntryConfigurationSchema.safeParse(SLICE).success).toBe(false);
  });
});
