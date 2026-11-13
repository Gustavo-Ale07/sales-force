import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../src/index.js';

/**
 * The text normalization of customer creation (CRLF, NBSP) must not cost the published contract its limits and
 * defaults: the generated client types are built from this document.
 */
type Json = Record<string, unknown>;
const schemas = (buildOpenApiDocument() as unknown as { components: { schemas: Record<string, Json> } }).components.schemas;
const request = schemas['CreateCustomerRequest'] as { properties: Record<string, Json>; required?: string[] };
const address = schemas['CustomerAddressInput'] as { properties: Record<string, Json>; required?: string[] };

/** The string branch of a nullable field (`anyOf: [string, null]`). */
function stringBranch(property: Json | undefined): Json {
  const branches = (property?.['anyOf'] ?? [property]) as Json[];
  return branches.find((b) => b['type'] === 'string') ?? {};
}

describe('CreateCustomerRequest in the OpenAPI document', () => {
  it('keeps maxLength, minLength and pattern of the text fields, notes included', () => {
    const expected: Array<[string, number]> = [['name', 100], ['tradeName', 100], ['stateRegistration', 16], ['notes', 4000]];
    for (const [field, max] of expected) {
      const branch = stringBranch(request.properties[field]);
      expect(branch['maxLength'], field).toBe(max);
      expect(branch['minLength'], field).toBe(1);
      expect(typeof branch['pattern'], field).toBe('string');
    }
    const complement = stringBranch(address.properties['complement']);
    expect(complement['maxLength']).toBe(30);
    expect(typeof complement['pattern']).toBe('string');
  });

  it('keeps the defaults of the optional fields', () => {
    expect(request.properties['tradeName']?.['default']).toBeNull();
    expect(request.properties['stateRegistration']?.['default']).toBeNull();
    expect(request.properties['notes']?.['default']).toBeNull();
    expect(request.properties['addresses']?.['default']).toEqual([]);
    expect(address.properties['complement']?.['default']).toBeNull();
  });
});
