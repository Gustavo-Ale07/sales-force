import { GatewayConfigError } from '../errors.js';

/**
 * Host allow-list (SNK-3). The real adapter talks only to hosts the installation explicitly
 * allow-listed through `SANKHYA_ALLOWED_HOSTS`. There is NO default: an empty list refuses everything.
 * Production is never a development/CI/staging target; the list is the last line of defence against a
 * copied `.env` pointing a non-production process at production.
 */

/** `a.example.com, b.example.com:8443` -> normalized lower-case entries. Blank entries are dropped. */
export function parseAllowedHosts(raw: string | undefined): readonly string[] {
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
}

/** Bare host or host:port; anything else (scheme, path, wildcard, credentials) is a config error. */
const ALLOWED_ENTRY = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

export function validateAllowedHosts(entries: readonly string[]): string[] {
  const problems: string[] = [];
  if (entries.length === 0) {
    problems.push('SANKHYA_ALLOWED_HOSTS must list the exact host(s) this installation may call (no default).');
  }
  for (const entry of entries) {
    if (!ALLOWED_ENTRY.test(entry)) {
      problems.push('SANKHYA_ALLOWED_HOSTS entries must be bare hosts (optionally host:port); no scheme, path or wildcard.');
      break;
    }
  }
  return problems;
}

export interface CheckedBaseUrl {
  /** Normalized origin, no trailing slash, `https` only. */
  readonly origin: string;
  /** `host` or `host:port` as matched against the allow-list. */
  readonly host: string;
}

/**
 * Returns the checked origin or a list of problems. Only `https` is accepted, without credentials,
 * query, fragment or path, and the host (with the port, when non-default) must be listed exactly.
 * Messages never echo the URL (it could carry a secret if mistyped).
 */
export function checkBaseUrl(
  baseUrl: string | undefined,
  allowedHosts: readonly string[],
): { ok: true; value: CheckedBaseUrl } | { ok: false; problems: string[] } {
  if (baseUrl === undefined || baseUrl.trim() === '') {
    return { ok: false, problems: ['SANKHYA_BASE_URL is required in live mode.'] };
  }
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return { ok: false, problems: ['SANKHYA_BASE_URL is not a valid URL.'] };
  }
  const problems: string[] = [];
  if (url.protocol !== 'https:') problems.push('SANKHYA_BASE_URL must use https.');
  if (url.username !== '' || url.password !== '') problems.push('SANKHYA_BASE_URL must not contain credentials.');
  if (url.search !== '' || url.hash !== '') problems.push('SANKHYA_BASE_URL must not contain a query or fragment.');
  if (url.pathname !== '/' && url.pathname !== '') problems.push('SANKHYA_BASE_URL must be an origin without a path.');
  const host = url.host.toLowerCase();
  if (!allowedHosts.includes(host)) {
    problems.push('SANKHYA_BASE_URL host is not listed in SANKHYA_ALLOWED_HOSTS; refusing to connect (SNK-3).');
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: { origin: `https://${host}`, host } };
}

export function assertBaseUrlAllowed(baseUrl: string, allowedHosts: readonly string[]): CheckedBaseUrl {
  const checked = checkBaseUrl(baseUrl, allowedHosts);
  if (!checked.ok) throw new GatewayConfigError(checked.problems);
  return checked.value;
}

/** Per-request re-check: the URL about to be requested must still be on the checked, allow-listed host. */
export function assertRequestUrlAllowed(url: string, allowedHosts: readonly string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GatewayConfigError(['Refusing a request to an invalid URL.']);
  }
  if (parsed.protocol !== 'https:' || !allowedHosts.includes(parsed.host.toLowerCase())) {
    throw new GatewayConfigError(['Refusing a request to a host that is not in SANKHYA_ALLOWED_HOSTS (SNK-3).']);
  }
}
