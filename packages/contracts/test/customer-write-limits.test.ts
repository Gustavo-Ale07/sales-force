import { describe, expect, it } from 'vitest';
import { CreateCustomerRequestSchema } from '../src/customer-write.js';

const base = {
  clientRequestId: '0194a1b2-7c3d-7e4f-8a5b-6c7d8e9f0a1b',
  document: '11222333000181',
  name: 'Cliente de teste',
};
const address = { streetCode: 1, neighborhoodCode: 2, number: '10', complement: null, postalCode: '01310100' };

function messages(input: Record<string, unknown>): string[] {
  const result = CreateCustomerRequestSchema.safeParse({ ...base, ...input });
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

/** TGFPAR limits read in the Sandbox (owner, 2026-11-13). Over the limit is refused, never cut. */
describe('CreateCustomerRequest field limits (TGFPAR)', () => {
  it('accepts values exactly at the limit', () => {
    const result = CreateCustomerRequestSchema.safeParse({
      ...base,
      name: 'N'.repeat(100),
      tradeName: 'R'.repeat(100),
      stateRegistration: 'I'.repeat(16),
      email: `${'a'.repeat(68)}@exemplo.com`,
      phone: '1'.repeat(13),
      notes: 'o'.repeat(4000),
      addresses: [{ ...address, number: '123456', complement: 'c'.repeat(30) }],
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ['name', { name: 'N'.repeat(101) }],
    ['tradeName', { tradeName: 'R'.repeat(101) }],
    ['stateRegistration', { stateRegistration: 'I'.repeat(17) }],
    ['email', { email: `${'a'.repeat(72)}@exemplo.com` }],
    ['phone', { phone: '1'.repeat(14) }],
    ['notes', { notes: 'o'.repeat(4001) }],
    ['addresses.0.number', { addresses: [{ ...address, number: '1234567' }] }],
    ['addresses.0.complement', { addresses: [{ ...address, complement: 'c'.repeat(31) }] }],
  ])('refuses %s over the limit with a message that names the field', (field, input) => {
    const found = messages(input);
    expect(found.some((entry) => entry.startsWith(field))).toBe(true);
  });

  it('phone is digits only, up to 13', () => {
    expect(messages({ phone: '(11) 99999-0000' }).some((entry) => entry.startsWith('phone'))).toBe(true);
    expect(CreateCustomerRequestSchema.safeParse({ ...base, phone: '11999990000' }).success).toBe(true);
  });

  it('postal code is exactly 8 digits', () => {
    expect(messages({ addresses: [{ ...address, postalCode: '01310-100' }] }).length).toBeGreaterThan(0);
    expect(messages({ addresses: [{ ...address, postalCode: '0131010' }] }).length).toBeGreaterThan(0);
  });

  it('document has at most 14 digits once punctuation is removed', () => {
    expect(messages({ document: '112223330001811' }).some((entry) => entry.startsWith('document'))).toBe(true);
    expect(CreateCustomerRequestSchema.safeParse({ ...base, document: '11.222.333/0001-81' }).success).toBe(true);
  });
});

/**
 * M-4 (security review of D-AR): text that reaches the ERP and other people's screens must not carry control,
 * invisible or direction-changing characters. Categories: C0/C1 controls, Unicode format characters (\p{Cf}: bidi
 * override/isolate, zero-width, word joiner, BOM...) and the line/paragraph separators U+2028/U+2029. Observations
 * (`notes`) are the only free text field: they keep newline and tab, nothing else of those categories.
 */
describe('CreateCustomerRequest text hygiene (M-4)', () => {
  const singleLineFields: Array<[string, (value: string) => Record<string, unknown>]> = [
    ['name', (v) => ({ name: v })],
    ['tradeName', (v) => ({ tradeName: v })],
    ['stateRegistration', (v) => ({ stateRegistration: v })],
    ['addresses.0.number', (v) => ({ addresses: [{ ...address, number: v }] })],
    ['addresses.0.complement', (v) => ({ addresses: [{ ...address, complement: v }] })],
  ];
  const forbidden: Array<[string, string]> = [
    ['C0 control (NUL)', 'A\u0000B'],
    ['C0 control (ESC)', 'A\u001bB'],
    ['DEL', 'A\u007fB'],
    ['C1 control (NEL)', 'A\u0085B'],
    ['bidi override (RLO)', 'A\u202eB'],
    ['bidi isolate (RLI)', 'A\u2067B'],
    ['bidi mark (RLM)', 'A\u200fB'],
    ['zero-width space', 'A\u200bB'],
    ['zero-width joiner', 'A\u200dB'],
    ['word joiner', 'A\u2060B'],
    ['byte order mark', 'A\ufeffB'],
    ['soft hyphen', 'A\u00adB'],
    ['line separator U+2028', 'A\u2028B'],
    ['paragraph separator U+2029', 'A\u2029B'],
    ['tab in a single-line field', 'A\tB'],
    ['newline in a single-line field', 'A\nB'],
  ];

  for (const [field, build] of singleLineFields) {
    it.each(forbidden)(`${field} refuses %s with a clear message`, (_label, value) => {
      const found = messages(build(value)).filter((entry) => entry.startsWith(field));
      expect(found.length).toBeGreaterThan(0);
      expect(found.join(' ')).toMatch(/não são permitidos/);
    });
  }

  it('keeps accented and ordinary text', () => {
    const result = CreateCustomerRequestSchema.safeParse({ ...base, name: 'Indústria João & Filhos — Ltda. (Matriz) nº 5' });
    expect(result.success).toBe(true);
  });

  describe('notes (the only multi-line field)', () => {
    it('keeps newline and tab', () => {
      expect(CreateCustomerRequestSchema.safeParse({ ...base, notes: 'linha 1\n\tlinha 2' }).success).toBe(true);
    });

    it.each(forbidden.filter(([label]) => !label.includes('single-line')))('refuses %s', (_label, value) => {
      const found = messages({ notes: value }).filter((entry) => entry.startsWith('notes'));
      expect(found.length).toBeGreaterThan(0);
      expect(found.join(' ')).toMatch(/não são permitidos/);
    });

    it('refuses a bare carriage return (only \\n and \\t are kept)', () => {
      expect(messages({ notes: 'a\rb' }).some((entry) => entry.startsWith('notes'))).toBe(true);
    });

    it('normalizes CRLF to LF instead of refusing it (text pasted from Windows)', () => {
      const parsed = CreateCustomerRequestSchema.parse({ ...base, notes: 'linha 1\r\nlinha 2\r\n\r\nlinha 4' });
      expect(parsed.notes).toBe('linha 1\nlinha 2\n\nlinha 4');
    });

    it('counts the normalized text against the limit (CRLF becomes one character)', () => {
      const raw = 'a'.repeat(3000) + 'x\r\n'.repeat(400); // 4200 raw characters, 3800 once normalized
      expect(CreateCustomerRequestSchema.safeParse({ ...base, notes: raw }).success).toBe(true);
    });
  });

  describe('NBSP, invisible fillers and emoji sequences (owner ruling 2026-11-13)', () => {
    const fields: Array<[string, (value: string) => Record<string, unknown>, (parsed: ReturnType<typeof CreateCustomerRequestSchema.parse>) => unknown]> = [
      ['name', (v) => ({ name: v }), (p) => p.name],
      ['notes', (v) => ({ notes: v }), (p) => p.notes],
      ['addresses.0.complement', (v) => ({ addresses: [{ ...address, complement: v }] }), (p) => p.addresses[0]?.complement],
    ];
    for (const [field, build, read] of fields) {
      it(`${field}: a non-breaking space becomes a regular space`, () => {
        expect(read(CreateCustomerRequestSchema.parse({ ...base, ...build('Rua Alfa  Beta') }))).toBe('Rua Alfa  Beta');
      });
      it.each([
        ['Hangul filler U+3164', 'AㅤB'],
        ['braille blank U+2800', 'A⠀B'],
        ['emoji with zero-width joiner', 'A\u{1F468}‍\u{1F469}B'],
      ])(`${field}: refuses %s`, (_label, value) => {
        const found = messages(build(value)).filter((entry) => entry.startsWith(field));
        expect(found.length).toBeGreaterThan(0);
        expect(found.join(' ')).toMatch(/não são permitidos/);
      });
    }
  });
});
