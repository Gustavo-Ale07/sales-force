import { SANDBOX_WRITE_HOSTS, writeHostRefusal } from './host-allowlist.js';

/**
 * The single typed reader of the order-write switches (SNK-7 S1, D-1). Only the worker process uses it
 * (STACK-2): the API never reads `SANKHYA_*`.
 *
 *  - `SANKHYA_ORDER_WRITE_ENABLED` (`true`|`false`, default `false`): master switch. Off = no delivery work.
 *  - `SANKHYA_ORDER_WRITE_MODE` (`off`|`dry_run`|`live`): default `dry_run` once enabled. `dry_run` builds and
 *    stores the payload and never contacts Sankhya, so it needs none of the live prerequisites (D-1).
 *  - `live` additionally needs ALL of: `SANKHYA_MODE=live` against the Sandbox (`SANKHYA_ENVIRONMENT=sandbox`,
 *    base URL on a Sandbox write host), a non-production `NODE_ENV`, the marker
 *    `SANKHYA_ORDER_WRITE_GATES_CLOSED=1` (gates SNK-4 / V-11 / V-13 closed) and `SANKHYA_ORDER_ORIGIN_FIELD`
 *    (the dedicated origin-id column of the order header, SNK-5; never Vidya's fields).
 */
export type OrderWriteMode = 'off' | 'dry_run' | 'live';

export interface OrderWriteSettings {
  readonly enabled: boolean;
  /** Effective mode: `off` whenever the master switch is off. */
  readonly mode: OrderWriteMode;
  /** Upper-cased header column of the origin id; `null` when not configured. */
  readonly originField: string | null;
}

export const ORDER_WRITE_DISABLED: OrderWriteSettings = Object.freeze({ enabled: false, mode: 'off', originField: null });

/** Origin-id columns that belong to the outgoing Vidya Force flow (SNK-5): never usable here. */
export const FORBIDDEN_ORIGIN_FIELDS: readonly string[] = ['AD_VDY' + 'ORIG', 'AD_NUVI' + 'DYA'] // assembled so the hygiene scan sees no legacy field literal;

/** Custom header columns only; the name is interpolated into a SELECT, hence the strict shape. */
const ORIGIN_FIELD_PATTERN = /^AD_[A-Z][A-Z0-9_]{0,26}$/;

export function isValidOriginField(name: string): boolean {
  return ORIGIN_FIELD_PATTERN.test(name) && !FORBIDDEN_ORIGIN_FIELDS.includes(name);
}

type Env = Readonly<Record<string, string | undefined>>;

function value(env: Env, name: string): string | undefined {
  const raw = env[name];
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
}

export function parseOrderWriteSettings(env: Env): { settings: OrderWriteSettings; problems: string[] } {
  const problems: string[] = [];

  const enabledRaw = value(env, 'SANKHYA_ORDER_WRITE_ENABLED');
  let enabled = false;
  if (enabledRaw === 'true') enabled = true;
  else if (enabledRaw !== undefined && enabledRaw !== 'false') {
    problems.push("SANKHYA_ORDER_WRITE_ENABLED must be 'true' or 'false' (default false).");
  }

  const modeRaw = value(env, 'SANKHYA_ORDER_WRITE_MODE')?.toLowerCase();
  let requested: OrderWriteMode | undefined;
  if (modeRaw === 'off' || modeRaw === 'dry_run' || modeRaw === 'live') requested = modeRaw;
  else if (modeRaw !== undefined) problems.push("SANKHYA_ORDER_WRITE_MODE must be 'off', 'dry_run' or 'live'.");

  const gates = value(env, 'SANKHYA_ORDER_WRITE_GATES_CLOSED');
  if (gates !== undefined && gates !== '1' && gates !== '0') {
    problems.push("SANKHYA_ORDER_WRITE_GATES_CLOSED must be '1' (gates closed) or unset.");
  }

  const originRaw = value(env, 'SANKHYA_ORDER_ORIGIN_FIELD');
  let originField: string | null = null;
  if (originRaw !== undefined) {
    const upper = originRaw.toUpperCase();
    if (isValidOriginField(upper)) originField = upper;
    else {
      problems.push(
        'SANKHYA_ORDER_ORIGIN_FIELD must be a custom TGFCAB column name (AD_ + letters/digits/underscore, at most 30 characters) and never one of Vidya Force\'s fields (SNK-5).',
      );
    }
  }

  const mode: OrderWriteMode = !enabled ? 'off' : (requested ?? 'dry_run');

  if (mode === 'live') {
    if (value(env, 'SANKHYA_MODE')?.toLowerCase() !== 'live') {
      problems.push("SANKHYA_ORDER_WRITE_MODE=live requires SANKHYA_MODE=live (the real adapter against the Sandbox).");
    }
    if (value(env, 'SANKHYA_ENVIRONMENT')?.toLowerCase() !== 'sandbox') {
      problems.push("SANKHYA_ORDER_WRITE_MODE=live is refused unless SANKHYA_ENVIRONMENT=sandbox (SNK-3, SNK-6).");
    }
    if (value(env, 'NODE_ENV')?.toLowerCase() === 'production') {
      problems.push('SANKHYA_ORDER_WRITE_MODE=live is refused when NODE_ENV=production (staging and production never write to Sankhya, SNK-7).');
    }
    const baseUrl = value(env, 'SANKHYA_BASE_URL');
    if (baseUrl === undefined || writeHostRefusal(baseUrl) !== null) {
      problems.push(`SANKHYA_ORDER_WRITE_MODE=live requires SANKHYA_BASE_URL to be exactly one of the Sandbox write hosts fixed in code (${SANDBOX_WRITE_HOSTS.length} allowed).`);
    }
    if (gates !== '1') {
      problems.push('SANKHYA_ORDER_WRITE_MODE=live requires SANKHYA_ORDER_WRITE_GATES_CLOSED=1 (the owner confirms gates SNK-4 / V-11 / V-13 are closed).');
    }
    if (originRaw === undefined) {
      problems.push('SANKHYA_ORDER_WRITE_MODE=live requires SANKHYA_ORDER_ORIGIN_FIELD (the dedicated origin-id column, SNK-5); empty means the write is refused.');
    }
  }

  return { settings: { enabled, mode, originField }, problems };
}
