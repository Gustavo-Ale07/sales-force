import { describe, expect, it } from 'vitest';
import { isReleaseLineDenied, releaseStateOf, type ErpReleaseLine } from '../src/index.js';

const pending = (event: number): ErpReleaseLine => ({ event, released: false, denied: false });
const released = (event: number): ErpReleaseLine => ({ event, released: true, denied: false });
const denied = (event: number): ErpReleaseLine => ({ event, released: false, denied: true });

describe('isReleaseLineDenied', () => {
  it('is denied by REPROVADO, whatever the date and the amount', () => {
    expect(isReleaseLineDenied({ released: false, reproved: true, releasedAmount: null })).toBe(true);
    expect(isReleaseLineDenied({ released: true, reproved: true, releasedAmount: 10 })).toBe(true);
  });

  it('is denied when released (dated) with a released amount of zero', () => {
    expect(isReleaseLineDenied({ released: true, reproved: false, releasedAmount: 0 })).toBe(true);
  });

  it('is a normal release when dated with an amount above zero', () => {
    expect(isReleaseLineDenied({ released: true, reproved: false, releasedAmount: 152.4 })).toBe(false);
  });

  it('is not denied while pending, nor when the amount was not reported', () => {
    expect(isReleaseLineDenied({ released: false, reproved: false, releasedAmount: 0 })).toBe(false);
    expect(isReleaseLineDenied({ released: false, reproved: false, releasedAmount: null })).toBe(false);
    expect(isReleaseLineDenied({ released: true, reproved: false, releasedAmount: null })).toBe(false);
  });
});

describe('releaseStateOf', () => {
  it('has no release state without TSILIB lines', () => {
    expect(releaseStateOf([])).toBeNull();
  });

  it('is awaiting when a line has no release date and is not denied', () => {
    expect(releaseStateOf([pending(44)])).toBe('awaiting');
    expect(releaseStateOf([released(44), pending(2)])).toBe('awaiting');
  });

  it('is released when every line has a release date', () => {
    expect(releaseStateOf([released(44)])).toBe('released');
    expect(releaseStateOf([released(44), released(3), released(13)])).toBe('released');
  });

  it('is denied when any line is denied, even if others are pending or released', () => {
    expect(releaseStateOf([denied(3)])).toBe('denied');
    expect(releaseStateOf([pending(44), denied(2)])).toBe('denied');
    expect(releaseStateOf([released(44), denied(13), released(3)])).toBe('denied');
  });

  it('keeps a denied line denied even if the ERP also filled its release date', () => {
    expect(releaseStateOf([{ event: 2, released: true, denied: true }])).toBe('denied');
  });
});
