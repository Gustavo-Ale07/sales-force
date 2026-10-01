import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/http/app-error.js';
import { assertDatasetMatches } from '../../src/platform/dataset-guard.js';

const A = { environment: 'sandbox', datasetId: 'plac-sandbox-real-1' };

describe('assertDatasetMatches', () => {
  it('accepts an identical identity', () => {
    expect(() => assertDatasetMatches(A, { ...A })).not.toThrow();
  });

  it.each([
    ['another datasetId', A, { ...A, datasetId: 'plac-sandbox-real-2' }],
    ['another environment', A, { ...A, environment: 'production' }],
    ['no declared identity', null, A],
  ])('rejects %s with dataset_mismatch (409)', (_name, declared, expected) => {
    try {
      assertDatasetMatches(declared, expected);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('dataset_mismatch');
      expect((error as AppError).status).toBe(409);
      expect((error as AppError).message).not.toContain(A.datasetId);
    }
  });
});
