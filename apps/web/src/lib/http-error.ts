/** Structural view of an API failure (the generated client's error type satisfies it). */
export interface HttpErrorLike {
  status: number;
  /** Server error code from `{ code, message, details? }`. */
  code?: string;
  message?: string;
  correlationId?: string;
}

export function isHttpError(error: unknown): error is HttpErrorLike {
  return typeof error === "object" && error !== null && typeof (error as { status?: unknown }).status === "number";
}

export function errorStatus(error: unknown): number | undefined {
  return isHttpError(error) ? error.status : undefined;
}

export function correlationIdOf(error: unknown): string | undefined {
  return isHttpError(error) ? error.correlationId : undefined;
}
