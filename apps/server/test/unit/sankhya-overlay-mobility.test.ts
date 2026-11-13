/* eslint-disable @typescript-eslint/no-explicit-any -- tests patch deliberately malformed facts */
import { PLAC_CONFIGURATION_FACTS, type ConfigurationFacts, type EnabledTopRow } from '@salesforce/sankhya';
import { describe, expect, it } from 'vitest';
import { overlayConfigurationFacts } from '../../src/configuration/sankhya-overlay.js';
import { baseConfiguration } from '../helpers/overlay-base.js';

function factsWith(patch: (facts: Record<string, any>) => void): ConfigurationFacts {
  const facts = structuredClone(PLAC_CONFIGURATION_FACTS) as unknown as Record<string, any>;
  patch(facts);
  return facts as ConfigurationFacts;
}

describe('AD_MOBILIDADE on TOPs and negotiation types (owner ruling 2026-11-13)', () => {
  const run = (patch: (facts: Record<string, any>) => void, previous?: any) =>
    overlayConfigurationFacts({ base: baseConfiguration(), facts: factsWith(patch), ...(previous === undefined ? {} : { previous }) });
  const kind = (result: ReturnType<typeof overlayConfigurationFacts>, name: string) => result.mobility.find((m) => m.kind === name);
  const previousSnapshot = () => overlayConfigurationFacts({ base: baseConfiguration(), facts: PLAC_CONFIGURATION_FACTS }).snapshot;

  it('a TOP with mobility S is visible; N and null are hidden', () => {
    const out = run((f) => {
      const rows = f['q3EnabledTops'].rows as EnabledTopRow[];
      (rows.find((t) => t.topCode === 1000) as any).mobile = false;
      (rows.find((t) => t.topCode === 2309) as any).mobile = null;
    });
    const eligible = (out.snapshot as any).sales.eligibleOrderTopCodes as number[];
    expect(eligible).not.toContain(2309);
    expect(eligible).not.toContain(1000);
    expect(eligible).toContain(1001);
    expect(kind(out, 'tops')).toMatchObject({ hidden: 2, keptPrevious: false });
  });

  it('a negotiation type with mobility N or null is hidden', () => {
    const out = run((f) => {
      f['q5NegotiationTypes'].rows[0].mobile = false;
      f['q5NegotiationTypes'].rows[1].mobile = null;
    });
    const codes = (out.snapshot as any).sales.negotiationTypes.map((t: any) => t.code) as number[];
    expect(codes).not.toContain(1);
    expect(codes).not.toContain(2);
    expect(kind(out, 'negotiationTypes')).toMatchObject({ hidden: 2, keptPrevious: false });
  });

  it('more than 90 percent hidden keeps the previous negotiation types, warns and reports the counts', () => {
    const previous = previousSnapshot();
    const out = run((f) => {
      f['q5NegotiationTypes'].rows.forEach((row: any, i: number) => {
        row.mobile = i < 3;
      });
    }, previous);
    expect((out.snapshot as any).sales.negotiationTypes).toEqual((previous as any).sales.negotiationTypes);
    expect(kind(out, 'negotiationTypes')).toEqual({ kind: 'negotiationTypes', visible: 3, hidden: 32, keptPrevious: true });
    expect(out.warnings.some((w) => w.code === 'mobility_guard_negotiation_types' && /avise o TI/i.test(w.message))).toBe(true);
  });

  it('everything hidden keeps the previous TOP lists', () => {
    const previous = previousSnapshot();
    const out = run((f) => {
      f['q3EnabledTops'].rows.forEach((row: any) => {
        row.mobile = false;
      });
    }, previous);
    expect((out.snapshot as any).sales.eligibleOrderTopCodes).toEqual((previous as any).sales.eligibleOrderTopCodes);
    expect((out.snapshot as any).sales.skipConfirmationTopCodes).toEqual((previous as any).sales.skipConfirmationTopCodes);
    expect(kind(out, 'tops')).toMatchObject({ visible: 0, keptPrevious: true });
    expect(out.warnings.some((w) => w.code === 'mobility_guard_tops')).toBe(true);
  });

  it('exactly 90 percent hidden is accepted', () => {
    const out = run((f) => {
      f['q5NegotiationTypes'].rows = f['q5NegotiationTypes'].rows.slice(0, 30);
      f['q5NegotiationTypes'].rows.forEach((row: any, i: number) => {
        row.mobile = i < 3;
      });
    });
    expect(kind(out, 'negotiationTypes')).toMatchObject({ visible: 3, hidden: 27, keptPrevious: false });
  });

  it('a hidden TOP that is the default TOP of the enabled company says to warn the IT and where it is used', () => {
    const out = run((f) => {
      (f['q3EnabledTops'].rows as any[]).find((t) => t.topCode === 1001).mobile = false;
    });
    const warning = out.warnings.find((w) => w.code === 'default_top_not_enabled');
    expect(warning?.message).toMatch(/avise o TI/i);
    expect(warning?.message).toContain('1001');
  });
});
