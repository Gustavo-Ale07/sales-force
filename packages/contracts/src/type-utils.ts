/** Compile-time helpers (types only; nothing is emitted at runtime). */
export type DeepMutable<T> = T extends readonly (infer U)[]
  ? DeepMutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T;

/** Strict type equality. */
export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export type Assert<T extends true> = T;

/** Mutual assignability (weaker than `Equals`; used only where a domain type mixes a record and known keys). */
export type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
