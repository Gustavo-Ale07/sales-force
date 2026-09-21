import type { LoggerService } from '@nestjs/common';
import type { Logger } from './logger.js';

/**
 * Routes NestJS framework logs through pino so that every line of the process is structured JSON.
 * Nest's routine `log` output (module init, route mapping) is written at `debug` to keep the
 * default level quiet; the entry points log their own start-up lines at `info`.
 */
export class NestPinoLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }
  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }
  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }
  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }
  verbose(message: unknown, ...params: unknown[]): void {
    this.write('trace', message, params);
  }
  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params);
  }

  private write(level: 'trace' | 'debug' | 'warn' | 'error' | 'fatal', message: unknown, params: unknown[]): void {
    const last = params.at(-1);
    const context = typeof last === 'string' ? last : undefined;
    const text = typeof message === 'string' ? message : message instanceof Error ? message.message : 'nest';
    const payload: Record<string, unknown> = { framework: context ?? 'nest' };
    if (message instanceof Error) payload['err'] = message;
    this.logger[level](payload, text);
  }
}
