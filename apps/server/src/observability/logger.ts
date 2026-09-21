import { isSankhyaGatewayError } from '@salesforce/sankhya';
import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import { PermanentJobError, TransientJobError } from '../worker/job-contract.js';
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

/** Any `scheme://...` up to the next whitespace: connection strings, URLs with credentials or tokens. */
const URI_PATTERN = /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s"'<>)]+/gi;

/** Masks URIs and connection strings in free text (log messages, error messages, stacks). */
export function maskUris(text: string): string {
  return text.replace(URI_PATTERN, (match) => `${match.slice(0, match.indexOf('://') + 3)}${REDACTED_PLACEHOLDER}`);
}

const MAX_CAUSE_DEPTH = 3;
const MAX_STACK_CHARS = 4000;

/** `code`, `constraint` and `table` are short identifiers; anything else (free text, URIs) is dropped. */
function shortIdentifier(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' && /^[\w$.:-]{1,80}$/.test(value) ? value : undefined;
}

function identifierFields(error: object): { code?: string; constraint?: string; table?: string } {
  const source = error as Record<string, unknown>;
  const fields: { code?: string; constraint?: string; table?: string } = {};
  const code = shortIdentifier(source['code']);
  const constraint = shortIdentifier(source['constraint']);
  const table = shortIdentifier(source['table']);
  if (code !== undefined) fields.code = code;
  if (constraint !== undefined) fields.constraint = constraint;
  if (table !== undefined) fields.table = table;
  return fields;
}

/**
 * Error as logged: an ALLOWLIST (type, message, stack, code, constraint, table, cause), never the
 * whole object. Database driver errors carry `detail`/`where` (row values, SQL text) and HTTP client
 * errors carry `config`/`request` (headers, bodies); none of those can reach a log through here.
 * Message and stack pass through `maskUris` (connection strings and URLs with credentials).
 */
export function serializeError(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: 'NonError' };
  const serialized: Record<string, unknown> = {
    type: error.name,
    message: maskUris(error.message),
    ...identifierFields(error),
  };
  if (typeof error.stack === 'string') serialized['stack'] = maskUris(error.stack).slice(0, MAX_STACK_CHARS);
  if (error.cause !== undefined && depth < MAX_CAUSE_DEPTH) serialized['cause'] = serializeError(error.cause, depth + 1);
  return serialized;
}

/**
 * Fields for a warn/error line about a failure whose text is not known to be secret-free (database
 * driver, network and unexpected errors): class, code, constraint and table only. Job errors and
 * Sankhya gateway errors are secret-free by contract and keep their (URI-masked) message.
 */
export function errorLogFields(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { errorName: 'NonError' };
  const fields: Record<string, unknown> = { errorName: error.name, ...identifierFields(error) };
  if (isSankhyaGatewayError(error) || error instanceof PermanentJobError || error instanceof TransientJobError) {
    fields['message'] = maskUris(error.message);
  }
  return fields;
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
    // A message can embed a connection string or a URL with credentials.
    hooks: {
      logMethod(args, method) {
        const masked: unknown[] = [...args];
        // `log(msg, ...)` or `log(object, msg, ...)`: the message is the first string argument.
        const index = typeof masked[0] === 'string' ? 0 : typeof masked[1] === 'string' ? 1 : -1;
        if (index !== -1) masked[index] = maskUris(masked[index] as string);
        return method.apply(this, masked as never);
      },
    },
    redact: { paths: buildRedactPaths(), censor: REDACTED_PLACEHOLDER },
    // Correlation: request id / job id of the current async call chain.
    mixin: (_merge, _level, self) => withoutBoundKeys(currentLogContext(), self),
    serializers: {
      err: serializeError,
      req: serializeRequest,
      res: (response: { statusCode?: number }) => ({ statusCode: response.statusCode }),
    },
  };
  return options.destination ? pino(config, options.destination) : pino(config);
}
