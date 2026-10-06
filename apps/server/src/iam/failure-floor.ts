/**
 * Minimum duration of a failed login (enumeration defense). The clock and the sleep are properties of one
 * mutable object so tests can freeze them and assert the padding deterministically, without real waiting.
 */
export const failureFloor = {
  now: (): number => Date.now(),
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Waits until `minMs` have passed since `startedAt` (a `failureFloor.now()` reading); never waits when already past it. */
export async function padFailure(startedAt: number, minMs: number): Promise<void> {
  const remaining = minMs - (failureFloor.now() - startedAt);
  if (remaining > 0) await failureFloor.sleep(remaining);
}
