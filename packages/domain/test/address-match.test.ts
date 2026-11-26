import { describe, expect, it } from 'vitest';
import { matchCity, matchNeighborhood, matchStreet } from '../src/address.js';

const cities = [
  { code: 10, name: 'SAO PAULO', uf: 'SP', ibge: '3550308' },
  { code: 11, name: 'São Paulo', uf: 'MG', ibge: null },
  { code: 12, name: 'Santo André', uf: 'SP', ibge: null },
];

describe('matchCity', () => {
  it('prefers IBGE + UF', () => {
    expect(matchCity(cities, { name: 'Outro Nome', uf: 'sp', ibge: '3550308' })?.code).toBe(10);
  });
  it('falls back to the normalized name + UF, never across states', () => {
    expect(matchCity(cities, { name: 'SANTO ANDRE', uf: 'SP', ibge: null })?.code).toBe(12);
    expect(matchCity(cities, { name: 'São Paulo', uf: 'MG', ibge: null })?.code).toBe(11);
    expect(matchCity(cities, { name: 'Santo André', uf: 'MG', ibge: null })).toBeNull();
  });
  it('is null when nothing matches or the name is ambiguous in the same state', () => {
    expect(matchCity(cities, { name: 'Inexistente', uf: 'SP', ibge: null })).toBeNull();
    const dup = [...cities, { code: 13, name: 'Santo Andre', uf: 'SP', ibge: null }];
    expect(matchCity(dup, { name: 'Santo André', uf: 'SP', ibge: null })).toBeNull();
  });
});

describe('matchNeighborhood', () => {
  const rows = [{ code: 1, name: 'Centro' }, { code: 2, name: 'JARDIM AÇUCAR' }];
  it('matches without accents or case', () => {
    expect(matchNeighborhood(rows, 'jardim acucar')?.code).toBe(2);
    expect(matchNeighborhood(rows, 'Vila Nova')).toBeNull();
  });
  it('is null on an ambiguous name', () => {
    expect(matchNeighborhood([...rows, { code: 3, name: 'CENTRO' }], 'centro')).toBeNull();
  });
});

describe('matchStreet', () => {
  const rows = [
    { code: 1, name: 'DAS FLORES', kind: 'RUA' },
    { code: 2, name: 'DAS FLORES', kind: 'AVENIDA' },
    { code: 3, name: 'DOM PEDRO', kind: null },
  ];
  it('matches type and name', () => {
    expect(matchStreet(rows, 'Rua das Flores')?.code).toBe(1);
    expect(matchStreet(rows, 'Av. das Flores')?.code).toBe(2);
  });
  it('matches a street stored without type when the text has none', () => {
    expect(matchStreet(rows, 'Dom Pedro')?.code).toBe(3);
  });
  it('is null when only the name matches but the type differs, or nothing matches', () => {
    expect(matchStreet(rows, 'Travessa das Flores')).toBeNull();
    expect(matchStreet(rows, 'Rua Inexistente')).toBeNull();
  });
});
