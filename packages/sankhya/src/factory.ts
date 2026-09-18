import { BootstrapFileConfigurationSource, type ConfigurationValidator } from './configuration-source.js';
import { GatewayConfigError } from './errors.js';
import { FakeGateway } from './fake/fake-gateway.js';
import type { EnvironmentKind, SankhyaGateway } from './gateway.js';
import { checkBaseUrl, parseAllowedHosts, validateAllowedHosts } from './real/host-guard.js';
import { MAX_PAGE_SIZE, RealSankhyaGateway } from './real/real-gateway.js';
import { Secret } from './secret.js';
import { createFetchTransport, type HttpTransport } from './real/transport.js';

export type GatewayEnvironment = Readonly<Record<string, string | undefined>>;

export interface CreateGatewayDependencies {
  /** HTTP seam for live mode (tests); defaults to `fetch`. */
  readonly transport?: HttpTransport;
  readonly now?: () => number;
  /** Required when `SF_CONFIG_FILE` is set: applies the `packages/contracts` schema. */
  readonly validateConfiguration?: ConfigurationValidator;
  readonly readConfigurationText?: (path: string) => Promise<string>;
}

const LIVE_ENVIRONMENTS: readonly Exclude<EnvironmentKind, 'demo' | 'production'>[] = ['sandbox', 'homologation'];

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

function parseIntegerVariable(
  env: GatewayEnvironment,
  name: string,
  range: { min: number; max: number },
  problems: string[],
): number | undefined {
  const raw = env[name];
  if (!present(raw)) return undefined;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    problems.push(`${name} must be an integer between ${range.min} and ${range.max}.`);
    return undefined;
  }
  return value;
}

/**
 * Builds the gateway for this process.
 *
 * - `SANKHYA_MODE` unset or `fake`: the synthetic FakeGateway (default; development, CI, demo).
 * - `SANKHYA_MODE=live`: the read-only real adapter, and only when EVERYTHING is explicit:
 *   `SANKHYA_BASE_URL`, `SANKHYA_ALLOWED_HOSTS` (no default; the base URL host must be listed),
 *   `SANKHYA_ENVIRONMENT` (`sandbox` or `homologation`; production is refused in this build, SNK-3/U-03),
 *   `SANKHYA_CLIENT_ID`, `SANKHYA_CLIENT_SECRET`, `SANKHYA_X_TOKEN`.
 *   Optional: `SANKHYA_PAGE_SIZE`, `SANKHYA_REQUEST_TIMEOUT_MS`, `SANKHYA_DB_UTC_OFFSET_MINUTES`, `SF_CONFIG_FILE`.
 *
 * Every problem is reported at once, by variable name only; values (credentials, URLs) are never echoed.
 * Only the worker process may call this in live mode (STACK-2).
 */
export function createGateway(env: GatewayEnvironment, deps: CreateGatewayDependencies = {}): SankhyaGateway {
  const modeRaw = env['SANKHYA_MODE'];
  const mode = present(modeRaw) ? modeRaw.trim().toLowerCase() : 'fake';
  if (mode === 'fake') return new FakeGateway();
  if (mode !== 'live') {
    throw new GatewayConfigError(["SANKHYA_MODE must be 'fake' (default) or 'live'."]);
  }

  const problems: string[] = [];

  const allowedHosts = parseAllowedHosts(env['SANKHYA_ALLOWED_HOSTS']);
  problems.push(...validateAllowedHosts(allowedHosts));

  let origin: string | undefined;
  const base = checkBaseUrl(env['SANKHYA_BASE_URL'], allowedHosts);
  if (base.ok) origin = base.value.origin;
  else problems.push(...base.problems.filter((problem) => !problems.includes(problem)));

  const environmentRaw = env['SANKHYA_ENVIRONMENT']?.trim().toLowerCase();
  let environmentKind: 'sandbox' | 'homologation' | undefined;
  if (environmentRaw === 'production') {
    problems.push(
      'SANKHYA_ENVIRONMENT=production is refused: production is never a development, CI or staging target and no production access is enabled in this build (SNK-3, U-03).',
    );
  } else if (LIVE_ENVIRONMENTS.some((kind) => kind === environmentRaw)) {
    environmentKind = environmentRaw as 'sandbox' | 'homologation';
  } else {
    problems.push("SANKHYA_ENVIRONMENT is required in live mode: 'sandbox' or 'homologation'.");
  }

  for (const name of ['SANKHYA_CLIENT_ID', 'SANKHYA_CLIENT_SECRET', 'SANKHYA_X_TOKEN']) {
    if (!present(env[name])) problems.push(`${name} is required in live mode (worker environment only; never commit it).`);
  }

  const pageSize = parseIntegerVariable(env, 'SANKHYA_PAGE_SIZE', { min: 1, max: MAX_PAGE_SIZE }, problems);
  const requestTimeoutMs = parseIntegerVariable(env, 'SANKHYA_REQUEST_TIMEOUT_MS', { min: 1000, max: 300_000 }, problems);
  const dbUtcOffsetMinutes = parseIntegerVariable(env, 'SANKHYA_DB_UTC_OFFSET_MINUTES', { min: -840, max: 840 }, problems);

  const configFile = env['SF_CONFIG_FILE'];
  if (present(configFile) && deps.validateConfiguration === undefined) {
    problems.push('SF_CONFIG_FILE is set but no configuration validator was supplied by the caller.');
  }

  const clientId = env['SANKHYA_CLIENT_ID'];
  const clientSecret = env['SANKHYA_CLIENT_SECRET'];
  const xToken = env['SANKHYA_X_TOKEN'];
  if (
    problems.length > 0 ||
    origin === undefined ||
    environmentKind === undefined ||
    !present(clientId) ||
    !present(clientSecret) ||
    !present(xToken)
  ) {
    throw new GatewayConfigError(problems);
  }

  const configurationSource =
    present(configFile) && deps.validateConfiguration !== undefined
      ? new BootstrapFileConfigurationSource({
          path: configFile.trim(),
          validate: deps.validateConfiguration,
          ...(deps.now ? { now: deps.now } : {}),
          ...(deps.readConfigurationText ? { readText: deps.readConfigurationText } : {}),
        })
      : undefined;

  return new RealSankhyaGateway({
    baseUrl: origin,
    allowedHosts,
    environmentKind,
    credentials: {
      clientId: new Secret(clientId),
      clientSecret: new Secret(clientSecret),
      xToken: new Secret(xToken),
    },
    transport: deps.transport ?? createFetchTransport(),
    ...(deps.now ? { now: deps.now } : {}),
    ...(pageSize !== undefined ? { pageSize } : {}),
    ...(requestTimeoutMs !== undefined ? { requestTimeoutMs } : {}),
    ...(dbUtcOffsetMinutes !== undefined ? { dbUtcOffsetMinutes } : {}),
    ...(configurationSource ? { configurationSource } : {}),
  });
}
