import { describe, expect, it } from 'vitest';
import { normalizeAddressName, splitStreetName } from '../src/address.js';

describe('normalizeAddressName', () => {
  it('ignores case, accents, surplus spaces and non-breaking spaces', () => {
    expect(normalizeAddressName('  São   João Batista ')).toBe('SAO JOAO BATISTA');
    expect(normalizeAddressName('Vila Açúcar')).toBe(normalizeAddressName('VILA ACUCAR'));
  });
});

describe('splitStreetName', () => {
  it('splits a known street type from the name, both uppercase and without accents', () => {
    expect(splitStreetName('Rua das Flores')).toEqual({ kind: 'RUA', name: 'DAS FLORES' });
    expect(splitStreetName('Avenida Paulista')).toEqual({ kind: 'AVENIDA', name: 'PAULISTA' });
    expect(splitStreetName('Praça da Sé')).toEqual({ kind: 'PRACA', name: 'DA SE' });
  });
  it('expands the usual abbreviations', () => {
    expect(splitStreetName('R. Augusta')).toEqual({ kind: 'RUA', name: 'AUGUSTA' });
    expect(splitStreetName('AV Brasil')).toEqual({ kind: 'AVENIDA', name: 'BRASIL' });
    expect(splitStreetName('Rod. Anhanguera')).toEqual({ kind: 'RODOVIA', name: 'ANHANGUERA' });
  });
  it('keeps the whole text as the name when there is no known type', () => {
    expect(splitStreetName('Dom Pedro')).toEqual({ kind: null, name: 'DOM PEDRO' });
  });
  it('never leaves the name empty: a lone type word is the name', () => {
    expect(splitStreetName('Rua')).toEqual({ kind: null, name: 'RUA' });
  });
});
