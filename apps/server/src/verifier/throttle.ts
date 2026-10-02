/**
 * Coarse protection of the verifier itself (the per-account and per-source throttles, lockout and audit stay in
 * the API). A fixed window counter over all callers plus a concurrency cap; in-process, so it resets on
 * restart and is per replica, which is acceptable because there is one verifier per environment.
 */
export class VerifierThrottle {
  #windowStart: number;
  #count = 0;
  #inFlight = 0;

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number,
    private readonly maxConcurrent: number,
    private readonly now: () => number = Date.now,
  ) {
    this.#windowStart = now();
  }

  /** Returns a release function, or null when over budget. The release is idempotent. */
  tryAcquire(): (() => void) | null {
    const current = this.now();
    if (current - this.#windowStart >= this.windowMs) {
      this.#windowStart = current;
      this.#count = 0;
    }
    if (this.#count >= this.maxPerWindow || this.#inFlight >= this.maxConcurrent) return null;
    this.#count += 1;
    this.#inFlight += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#inFlight -= 1;
    };
  }
}
