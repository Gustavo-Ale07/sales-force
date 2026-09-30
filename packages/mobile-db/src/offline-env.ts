/** Injected clock and id source (testing.md: inject clock and randomness). */
export interface OfflineEnv {
  now(): Date;
  /** A fresh UUID (v4-shaped is fine: these are local ids and idempotency keys, never security tokens). */
  newId(): string;
}

export function isoNow(env: OfflineEnv): string {
  return env.now().toISOString();
}

/**
 * Lower-cases and strips accents so "Açúcar" is found by "acucar". Product/customer search runs on this column with
 * indexed-friendly LIKE (FTS5 is not usable on this build, see `docs/mobile-spike.md` §8.1).
 */
export function normalizeSearchText(value: string): string {
  let text = value.toLowerCase();
  try {
    text = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
  } catch {
    // Engines without String.prototype.normalize: keep the lower-cased text.
  }
  return text.replace(/\s+/g, " ").trim();
}

/** Escapes `%`, `_` and the escape character itself for `LIKE ... ESCAPE '\'`. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}
