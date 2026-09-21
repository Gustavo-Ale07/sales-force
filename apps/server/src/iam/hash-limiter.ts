/**
 * Bounds the password-hashing work in flight (login DoS). Argon2id through WebAssembly costs about
 * 100 ms of CPU and 19 MiB per attempt and runs on the event loop, so an unbounded number of
 * concurrent logins would starve the whole API. A caller that cannot get a slot is told to retry
 * later (429) instead of queueing.
 */
export class HashLimiter {
  #inFlight = 0;

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new Error('HashLimiter needs a positive integer capacity');
  }

  get inFlight(): number {
    return this.#inFlight;
  }

  /** A release function when a slot was free, otherwise `null`. The release is idempotent. */
  tryAcquire(): (() => void) | null {
    if (this.#inFlight >= this.max) return null;
    this.#inFlight += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#inFlight -= 1;
    };
  }
}
