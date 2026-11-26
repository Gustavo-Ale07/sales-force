import { describe, expect, it } from 'vitest';
import { contactVersionOf } from '../../src/customers/contact-version.js';

describe('contactVersionOf', () => {
  it('ignores formatting of the phone and the case of the e-mail', () => {
    expect(contactVersionOf('(11) 99999-0000', 'Ana@Exemplo.com')).toBe(contactVersionOf('11999990000', 'ana@exemplo.com'));
  });

  it('treats null, undefined and empty alike', () => {
    expect(contactVersionOf(null, undefined)).toBe(contactVersionOf('', ''));
  });

  it('changes when the phone or the e-mail changes', () => {
    const base = contactVersionOf('11999990000', 'a@b.com');
    expect(contactVersionOf('11999990001', 'a@b.com')).not.toBe(base);
    expect(contactVersionOf('11999990000', 'c@b.com')).not.toBe(base);
  });
});
