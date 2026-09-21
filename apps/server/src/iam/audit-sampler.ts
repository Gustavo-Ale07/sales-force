/**
 * Bounds the audit rows written for repeated, identical, machine-generated events (blocked or
 * throttled login attempts). Inside one window per scope the 1st, 2nd, 4th, 8th, ... occurrence is
 * recorded (with the running count), so a flood of N attempts writes about log2(N) rows instead of N.
 * In-process on purpose: a flood must not cost a database write per rejected attempt. Several API
 * instances sample independently; the bound then multiplies by the instance count, not by N.
 */
export class AuditSampler {
  readonly #windows = new Map<string, { startedAt: number; count: number }>();

  constructor(private readonly windowMs: number) {}

  /** Counts one occurrence of `scope` and says whether this one must be written to the audit trail. */
  observe(scope: string, now: Date): { record: boolean; count: number } {
    const at = now.getTime();
    let window = this.#windows.get(scope);
    if (window === undefined || at - window.startedAt >= this.windowMs) {
      window = { startedAt: at, count: 0 };
      this.#windows.set(scope, window);
    }
    window.count += 1;
    return { record: (window.count & (window.count - 1)) === 0, count: window.count };
  }
}
