import { describe, expect, it } from 'vitest';
import { ORDER_HEADER_ISSUE_LABEL, orderHeaderIssues } from '../src/index.js';

const complete = { topCode: 3, negotiationTypeCode: 2, freightType: 'CIF', carrierCode: 55 } as const;

describe('orderHeaderIssues (TOP, negotiation, freight and carrier are mandatory)', () => {
  it('a complete header has no issue', () => {
    expect(orderHeaderIssues(complete)).toEqual([]);
  });
  it('reports every missing field in screen order', () => {
    expect(orderHeaderIssues({ topCode: null, negotiationTypeCode: null, freightType: null, carrierCode: null })).toEqual([
      'missing_top',
      'missing_negotiation_type',
      'missing_freight_type',
      'missing_carrier',
    ]);
  });
  it.each([
    ['missing_top', { topCode: null }],
    ['missing_negotiation_type', { negotiationTypeCode: undefined }],
    ['missing_freight_type', { freightType: null }],
    ['missing_carrier', { carrierCode: null }],
  ] as const)('only %s', (code, patch) => {
    expect(orderHeaderIssues({ ...complete, ...patch })).toEqual([code]);
  });
  it('every freight option counts, including "Sem frete"; an unknown value does not', () => {
    for (const freightType of ['CIF', 'FOB', 'SEM_FRETE']) expect(orderHeaderIssues({ ...complete, freightType })).toEqual([]);
    expect(orderHeaderIssues({ ...complete, freightType: 'X' })).toEqual(['missing_freight_type']);
  });
  it('a carrier code counts only when it is a real code (a deliberate pick), never when absent or invalid', () => {
    expect(orderHeaderIssues({ ...complete, carrierCode: 0 })).toEqual([]);
    expect(orderHeaderIssues({ ...complete, carrierCode: -1 })).toEqual(['missing_carrier']);
    expect(orderHeaderIssues({ ...complete, carrierCode: 1.5 })).toEqual(['missing_carrier']);
  });
  it('has a label for every code', () => {
    expect(Object.keys(ORDER_HEADER_ISSUE_LABEL).sort()).toEqual(['missing_carrier', 'missing_freight_type', 'missing_negotiation_type', 'missing_top']);
  });
});
