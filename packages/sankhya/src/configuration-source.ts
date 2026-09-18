import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { ConfigurationSourceKind, InstallationConfiguration } from '@salesforce/domain';
import { NotImplementedError, SankhyaGatewayError } from './errors.js';
import type { ReadOptions } from './gateway.js';

/**
 * Where an installation's configuration snapshot comes from (CFG-1, U-10, U-11).
 *
 * The Sankhya-side configuration model does not exist yet (U-10), so `readConfiguration()` of the
 * real client cannot read it: that path raises `NotImplementedError`. Until the model exists the
 * snapshot comes from a bootstrap file (`source.kind = 'bootstrap-file'`, U-11) validated by a
 * caller-supplied validator. The server applies the `packages/contracts` schema there; this package
 * stays free of contracts.
 */
export interface ConfigurationSource {
  readonly kind: ConfigurationSourceKind;
  read(options?: ReadOptions): Promise<InstallationConfiguration>;
}

export type ConfigurationValidationResult =
  | { readonly ok: true; readonly value: InstallationConfiguration }
  | { readonly ok: false; readonly issues: readonly string[] };

/** Validates untrusted JSON as an `InstallationConfiguration` (schema + consistency). Must not throw. */
export type ConfigurationValidator = (raw: unknown) => ConfigurationValidationResult;

/** Stand-in used by the real client when no bootstrap file is configured. */
export const NO_CONFIGURATION_SOURCE_MESSAGE =
  'readConfiguration: the Sankhya-side installation configuration model does not exist yet - NEEDS VALIDATION U-10 / U-11 ' +
  '(docs/implementation/sankhya-configuration-contract.md). Provide SF_CONFIG_FILE to use the bootstrap file source.';

export class UnavailableConfigurationSource implements ConfigurationSource {
  readonly kind: ConfigurationSourceKind = 'sankhya';

  read(): Promise<InstallationConfiguration> {
    return Promise.reject(new NotImplementedError(NO_CONFIGURATION_SOURCE_MESSAGE));
  }
}

const MAX_CONFIG_FILE_CHARS = 1_000_000;
const MAX_ISSUES_IN_MESSAGE = 10;

export interface BootstrapFileConfigurationSourceOptions {
  /** Path from `SF_CONFIG_FILE`. Never derived from user input. */
  readonly path: string;
  readonly validate: ConfigurationValidator;
  /** Injected clock (ms since epoch); defaults to the system clock. */
  readonly now?: () => number;
  /** Injected file reader (tests); defaults to reading `path` as UTF-8. */
  readonly readText?: (path: string) => Promise<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the installation configuration from a JSON file. The file holds the same structure as the
 * `InstallationConfiguration` snapshot. `source` may be omitted; when present its `kind` must be
 * `bootstrap-file` (a file can never claim to come from Sankhya or the demo). The loader stamps
 * `source` with `kind = 'bootstrap-file'`, a version (the file's own `source.version`, or a short
 * content hash) and `syncedAt` (now), then hands the result to the validator. Secrets are never part
 * of the configuration; the file must not contain any.
 */
export class BootstrapFileConfigurationSource implements ConfigurationSource {
  readonly kind: ConfigurationSourceKind = 'bootstrap-file';
  readonly #options: BootstrapFileConfigurationSourceOptions;

  constructor(options: BootstrapFileConfigurationSourceOptions) {
    if (options.path.trim() === '') {
      throw new TypeError('BootstrapFileConfigurationSource requires a file path');
    }
    this.#options = options;
  }

  async read(options?: ReadOptions): Promise<InstallationConfiguration> {
    options?.signal?.throwIfAborted();
    const { path, validate } = this.#options;

    let text: string;
    try {
      text = await (this.#options.readText ?? ((p) => readFile(p, 'utf8')))(path);
    } catch (cause) {
      throw new SankhyaGatewayError('permanent', {
        code: 'config_file_unreadable',
        message: 'The bootstrap configuration file (SF_CONFIG_FILE) could not be read; check that it exists and is readable by the worker.',
        cause,
      });
    }
    if (text.length > MAX_CONFIG_FILE_CHARS) {
      throw new SankhyaGatewayError('validation', {
        code: 'config_file_too_large',
        message: 'The bootstrap configuration file is unreasonably large; it must contain the configuration snapshot only.',
      });
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      // The parser message can echo file content; keep it out of the error.
      throw new SankhyaGatewayError('validation', {
        code: 'config_file_invalid_json',
        message: 'The bootstrap configuration file is not valid JSON.',
      });
    }
    if (!isRecord(raw)) {
      throw new SankhyaGatewayError('validation', {
        code: 'config_file_invalid',
        message: 'The bootstrap configuration file must contain a JSON object.',
      });
    }

    const declared = raw['source'];
    if (declared !== undefined && (!isRecord(declared) || declared['kind'] !== 'bootstrap-file')) {
      throw new SankhyaGatewayError('validation', {
        code: 'config_file_source_kind',
        message: "The bootstrap configuration file may only declare source.kind = 'bootstrap-file'.",
      });
    }
    const declaredVersion = isRecord(declared) ? declared['version'] : undefined;
    const version =
      typeof declaredVersion === 'string' && declaredVersion.trim() !== ''
        ? declaredVersion.trim()
        : `sha256:${createHash('sha256').update(text).digest('hex').slice(0, 12)}`;
    const syncedAt = new Date((this.#options.now ?? Date.now)()).toISOString();

    const result = validate({
      ...raw,
      source: { kind: 'bootstrap-file', version, syncedAt },
    });
    if (!result.ok) {
      const shown = result.issues.slice(0, MAX_ISSUES_IN_MESSAGE).join('; ');
      throw new SankhyaGatewayError('validation', {
        code: 'config_file_invalid',
        message: `The bootstrap configuration file failed validation: ${shown.slice(0, 500)}`,
      });
    }
    return result.value;
  }
}
