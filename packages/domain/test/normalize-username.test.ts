import { describe, expect, it } from 'vitest';
import { normalizeUsername } from '../src/index.js';

describe('normalizeUsername', () => {
  it('trims only: keeps case, dots, digits and any "@"', () => {
    expect(normalizeUsername('  SAMUEL  ')).toBe('SAMUEL');
    expect(normalizeUsername('usuario.teste')).toBe('usuario.teste');
    expect(normalizeUsername('Admin@Example.Test')).toBe('Admin@Example.Test');
  });

  it('does not require a domain or strip anything inside the name', () => {
    expect(normalizeUsername('gustavo')).toBe('gustavo');
    expect(normalizeUsername('a b')).toBe('a b');
  });
});
