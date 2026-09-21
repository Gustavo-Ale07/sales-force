/** Dependency-injection tokens shared by the API and Worker modules. */
export const LOGGER = Symbol('LOGGER');
/** Drizzle `Database` (application queries). */
export const DATABASE = Symbol('DATABASE');
/** The `DbHandle` (pool + close): only readiness and shutdown use it directly. */
export const DATABASE_HANDLE = Symbol('DATABASE_HANDLE');
export const CLOCK = Symbol('CLOCK');

/** Injected time source; tests replace it (no hidden `Date.now()` in application services). */
export type Clock = () => Date;
export const systemClock: Clock = () => new Date();
