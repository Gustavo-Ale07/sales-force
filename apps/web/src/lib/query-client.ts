import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { errorStatus } from "./http-error";

export interface QueryClientOptions {
  /** Called once when any request answers 401 (session expired/revoked): clear caches and go to login. */
  onUnauthorized: () => void;
}

/** 401/403/404 are answers, not transient failures: never retried. Others retry twice. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = errorStatus(error);
  if (status !== undefined && status >= 400 && status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient({ onUnauthorized }: QueryClientOptions): QueryClient {
  const handle = (error: unknown) => {
    if (errorStatus(error) === 401) onUnauthorized();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError: handle }),
    mutationCache: new MutationCache({ onError: handle }),
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetry, refetchOnWindowFocus: false },
    },
  });
}
