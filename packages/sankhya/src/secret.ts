/**
 * Holds a credential so it cannot leak through logging, JSON serialization or string interpolation.
 * The only way to read the value is `reveal()`, used exactly where the credential is sent (SEC-1).
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TypeError('A secret must be a non-empty string');
    }
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return '[redacted]';
  }

  toJSON(): string {
    return '[redacted]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[redacted]';
  }
}
