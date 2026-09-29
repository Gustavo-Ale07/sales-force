/**
 * Generates a `clientRequestId` for `POST /orders` (idempotency key only, never a security token). Hermes has no
 * built-in `crypto.randomUUID`/`crypto.getRandomValues` and the app has no CSPRNG dependency yet, so this uses
 * `Math.random`. That is acceptable here (security.md's CSPRNG rule covers tokens and session ids, not a
 * client-side dedup correlation id) but should move to `expo-crypto`'s `randomUUID()` once that dependency is
 * added for another reason.
 */
export function newClientRequestId(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return template.replace(/[xy]/g, (char) => {
    if (char === "x") return hex();
    // `y` is one of 8/9/a/b (the UUID variant bits).
    return ((Math.floor(Math.random() * 4) + 8) & 0xf).toString(16);
  });
}
