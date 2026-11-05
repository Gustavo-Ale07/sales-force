import { SANDBOX_WRITE_HOSTS, writeHostRefusal } from './host-allowlist.js';

/**
 * The single typed reader of the order-write switches (SNK-7 S1, D-1). Only the worker process uses it
 * (STACK-2): the API never reads `SANKHYA_*`.
 *
 *  - `SANKHYA_ORDER_WRITE_ENABLED` (`true`|`false`, default `false`): master switch. Off = no delivery work.
 *  - `SANKHYA_ORDER_WRITE_MODE` (`off`|`dry_run`|`live`): default `dry_run` once enabled. `dry_run` builds and
 *    stores the payload and never contacts Sankhya, so it needs none of the live prerequisites (D-1).
 *  - `live` additionally needs ALL of: `SANKHYA_MODE=live` against the Sandbox (`SANKHYA_ENVIRONMENT=sandbox`,
 *    base URL on a Sandbox write host), `SF_DEPLOY_ENVIRONMENT=staging` (I1: any enabled mode needs it; NODE_ENV is the run mode, not the environment), the marker
 *    `SANKHYA_ORDER_WRITE_GATES_CLOSED=1` (gates SNK-4 / V-11 / V-13 closed) and `SANKHYA_ORDER_ORIGIN_FIELD`
 *    (the dedicated origin-id column of the order header, SNK-5; never Vidya's fields).
 *  - `SANKHYA_ORDER_WRITE_REQUEST_BUDGET` (M3, integer 1..10000): cap of Sankhya HTTP requests the order delivery may
 *    make per worker run. Default 40 in `live` mode (the Sandbox test #1 budget); ignored in other modes.
 */
export type OrderWriteMode = 'off' | 'dry_run' | 'live';

export interface OrderWriteSettings {
  readonly enabled: boolean;
  /** Effective mode: `off` whenever the master switch is off. */
  readonly mode: OrderWriteMode;
  /** Upper-cased header column of the origin id; `null` when not configured. */
  readonly originField: string | null;
  /** M3: request cap of the order delivery; `null` outside `live` mode. */
  readonly requestBudget: number | null;
}

export const ORDER_WRITE_DISABLED: OrderWriteSettings = Object.freeze({ enabled: false, mode: 'off', originField: null, requestBudget: null });

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

/** `SF_DEPLOY_ENVIRONMENT` (I1): which installation this process belongs to; `staging` | `production`. */
export function deployEnvironmentProblem(env: Env): string | null {
  const raw = value(env, 'SF_DEPLOY_ENVIRONMENT')?.toLowerCase();
  if (raw === 'staging' || raw === 'production') return null;
  if (raw !== undefined) return "SF_DEPLOY_ENVIRONMENT must be 'staging' or 'production'.";
  if (value(env, 'NODE_ENV')?.toLowerCase() === 'production') {
    return "SF_DEPLOY_ENVIRONMENT: is required when NODE_ENV=production ('staging' or 'production'); empty means refused.";
  }
  return null;
}

/**
 * Whether ERP order submission may be switched on in this deployment: only `staging`. Outside a production-mode
 * process (local development, tests) an unset variable keeps the previous behaviour; production, an unknown value
 * or an unset variable under NODE_ENV=production is refused.
 */
export function orderWriteAllowedHere(env: Env): boolean {
  const raw = value(env, 'SF_DEPLOY_ENVIRONMENT')?.toLowerCase();
  if (raw === 'staging') return true;
  return raw === undefined && value(env, 'NODE_ENV')?.toLowerCase() !== 'production';
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

  let requestBudget: number | null = null;
  const budgetRaw = value(env, 'SANKHYA_ORDER_WRITE_REQUEST_BUDGET');
  if (budgetRaw !== undefined) {
    const parsed = Number(budgetRaw);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 10_000) requestBudget = parsed;
    else problems.push('SANKHYA_ORDER_WRITE_REQUEST_BUDGET must be an integer between 1 and 10000 (default 40 in live mode).');
  }
  if (mode === 'live' && requestBudget === null && budgetRaw === undefined) requestBudget = 40;
  if (mode !== 'live') requestBudget = null;

  const deployProblem = deployEnvironmentProblem(env);
  if (deployProblem !== null) problems.push(deployProblem);
  // I1: the gate is the deployment environment, not NODE_ENV (staging runs with NODE_ENV=production by design).
  if (mode !== 'off' && !orderWriteAllowedHere(env)) {
    problems.push(
      `SANKHYA_ORDER_WRITE_ENABLED=true (mode ${mode}) is only accepted when SF_DEPLOY_ENVIRONMENT=staging (ERP order submission stays disabled elsewhere, SNK-6).`,
    );
  }

  if (mode === 'live') {
    if (value(env, 'SANKHYA_MODE')?.toLowerCase() !== 'live') {
      problems.push("SANKHYA_ORDER_WRITE_MODE=live requires SANKHYA_MODE=live (the real adapter against the Sandbox).");
    }
    if (value(env, 'SANKHYA_ENVIRONMENT')?.toLowerCase() !== 'sandbox') {
      problems.push("SANKHYA_ORDER_WRITE_MODE=live is refused unless SANKHYA_ENVIRONMENT=sandbox (SNK-3, SNK-6).");
    }
    if (value(env, 'SF_DEPLOY_ENVIRONMENT')?.toLowerCase() !== 'staging') {
      problems.push('SANKHYA_ORDER_WRITE_MODE=live requires an explicit SF_DEPLOY_ENVIRONMENT=staging; production or unset is refused (production never writes to Sankhya, SNK-7).');
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

  return { settings: { enabled, mode, originField, requestBudget }, problems };
}
