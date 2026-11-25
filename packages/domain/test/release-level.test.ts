import { describe, expect, it } from 'vitest';
import { RELEASE_NOT_CONFIRMED_LABEL, awaitedReleaseLevel, releaseLevelLabel, releaseLevelText } from '../src/release-level.js';

const line = (cascadeSequence: number | null, over: Partial<{ event: number; released: boolean; reproved: boolean }> = {}) => ({
  event: 44,
  cascadeSequence,
  released: false,
  reproved: false,
  ...over,
});

describe('awaitedReleaseLevel (owner 2026-11-25: level = SEQCASCATA of the pending EVENTO 44 line)', () => {
  it('no line at all is "not confirmed in Sankhya", never an error', () => {
    expect(awaitedReleaseLevel([])).toEqual({ state: 'not_confirmed', level: null });
  });

  it('waits for the lowest SEQCASCATA still pending', () => {
    expect(awaitedReleaseLevel([line(2), line(1)])).toEqual({ state: 'awaiting', level: 1 });
  });

  it('a released level is skipped: the next one is awaited', () => {
    expect(awaitedReleaseLevel([line(1, { released: true }), line(2)])).toEqual({ state: 'awaiting', level: 2 });
    expect(awaitedReleaseLevel([line(1, { released: true }), line(2, { released: true }), line(3)])).toEqual({ state: 'awaiting', level: 3 });
  });

  it('every line released: nothing awaited', () => {
    expect(awaitedReleaseLevel([line(1, { released: true }), line(2, { released: true })])).toEqual({ state: 'none', level: null });
  });

  it('only EVENTO 44 defines the level; other events never do', () => {
    expect(awaitedReleaseLevel([line(1, { event: 3 }), line(2, { event: 13 })])).toEqual({ state: 'none', level: null });
    expect(awaitedReleaseLevel([line(1, { event: 3 }), line(2)])).toEqual({ state: 'awaiting', level: 2 });
  });

  it('lines of other events still count as "confirmed" (a line exists)', () => {
    expect(awaitedReleaseLevel([line(null, { event: 3 })]).state).toBe('none');
  });

  it('a line without SEQCASCATA gives no level', () => {
    expect(awaitedReleaseLevel([line(null)])).toEqual({ state: 'none', level: null });
  });

  it('level 0 (old orders) is a valid level', () => {
    expect(awaitedReleaseLevel([line(0)])).toEqual({ state: 'awaiting', level: 0 });
  });

  it('a reproved line does not change the level (Barrado is the stage, decided apart)', () => {
    expect(awaitedReleaseLevel([line(1, { reproved: true }), line(2)])).toEqual({ state: 'awaiting', level: 1 });
  });

  it('does not mutate the input', () => {
    const input = [line(2), line(1)];
    awaitedReleaseLevel(input);
    expect(input.map((l) => l.cascadeSequence)).toEqual([2, 1]);
  });
});

describe('labels shared by site and app', () => {
  it('"Nível N"', () => {
    expect(releaseLevelLabel(1)).toBe('Nível 1');
    expect(releaseLevelLabel(3)).toBe('Nível 3');
  });
  it('text per state', () => {
    expect(releaseLevelText({ state: 'awaiting', level: 2 })).toBe('Nível 2');
    expect(releaseLevelText({ state: 'not_confirmed', level: null })).toBe(RELEASE_NOT_CONFIRMED_LABEL);
    expect(RELEASE_NOT_CONFIRMED_LABEL).toBe('Ainda não confirmado no Sankhya');
    expect(releaseLevelText({ state: 'none', level: null })).toBeNull();
  });
});
