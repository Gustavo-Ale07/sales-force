import { pino, stdSerializers, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import { currentLogContext, type LogContext } from './request-context.js';

export type { Logger };

/**
 * Field names whose value is never written to a log, wherever it appears (up to four levels deep,
 * which covers `req.headers.authorization`, `err.config.headers.x-token`, ...). Redaction is a
 * safety net: callers still must not log credentials, request bodies of auth/sync/import endpoints
 * or personal data (security rules, "Logging and error reporting").
 */
export const REDACTED_KEYS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-token',
  'x-api-key',
  'password',
  'passwordHash',
  'password_hash',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'sessionId',
  'sessionToken',
  'secret',
  'clientSecret',
  'apiKey',
  'databaseUrl',
  'connectionString',
  'otp',
] as const;

export const REDACTED_PLACEHOLDER = '[redacted]';

function accessor(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : `["${key}"]`;
}

const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Pino matches paths case-sensitively, and header names arrive as `Authorization`, `x-token`,
 * `X-Token`, `set-cookie`, ...; body fields as `password`, `Password`, `password_hash`, `passwordHash`.
 * Every configured key is therefore expanded to its spelling variants: kebab, snake, camel, Pascal,
 * Title-Kebab, Title_Snake, and the upper-case forms.
 */
export function caseVariants(key: string): string[] {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
  const [first = '', ...rest] = words;
  const variants = [
    key,
    words.join('-'),
    words.join('_'),
    words.join(''),
    [first, ...rest.map(capitalize)].join(''),
    words.map(capitalize).join(''),
    words.map(capitalize).join('-'),
    words.map(capitalize).join('_'),
    words.join('-').toUpperCase(),
    words.join('_').toUpperCase(),
  ];
  return [...new Set(variants)];
}

/** Builds the pino `redact.paths` list for `REDACTED_KEYS` (all spelling variants, four levels deep). */
export function buildRedactPaths(keys: readonly string[] = REDACTED_KEYS): string[] {
  const paths = new Set<string>();
  for (const key of keys.flatMap(caseVariants)) {
    const leaf = accessor(key);
    const bracket = leaf.startsWith('[');
    paths.add(leaf);
    for (let depth = 1; depth <= 4; depth += 1) {
      const wildcards = Array.from({ length: depth }, () => '*').join('.');
      paths.add(bracket ? `${wildcards}${leaf}` : `${wildcards}.${leaf}`);
    }
  }
  return [...paths];
}

export interface CreateLoggerOptions {
  readonly level: string;
  /** Process label written on every line: `api` or `worker`. */
  readonly service: string;
  /** Tests pass a stream to capture lines; production writes JSON to stdout. */
  readonly destination?: DestinationStream;
}

/** The request as logged: method and path only (no query string, headers or body). */
function serializeRequest(request: { method?: string; url?: string; id?: string }) {
  const url = request.url ?? '';
  const queryStart = url.indexOf('?');
  return { method: request.method, url: queryStart === -1 ? url : url.slice(0, queryStart) };
}

/**
 * Context fields for a log line, minus the ones the (child) logger already binds: the Fastify request
 * logger binds `requestId` itself, and a key must not appear twice in a line.
 */
function withoutBoundKeys(context: LogContext | undefined, logger: Logger): Record<string, string> {
  if (context === undefined) return {};
  const bound = logger.bindings();
  return Object.fromEntries(Object.entries(context).filter(([key]) => !(key in bound)));
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const config: LoggerOptions = {
    level: options.level,
    base: { service: options.service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: buildRedactPaths(), censor: REDACTED_PLACEHOLDER },
    // Correlation: request id / job id of the current async call chain.
    mixin: (_merge, _level, self) => withoutBoundKeys(currentLogContext(), self),
    serializers: {
      err: stdSerializers.err,
      req: serializeRequest,
      res: (response: { statusCode?: number }) => ({ statusCode: response.statusCode }),
    },
  };
  return options.destination ? pino(config, options.destination) : pino(config);
}
