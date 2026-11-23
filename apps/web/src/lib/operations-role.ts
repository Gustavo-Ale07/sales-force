/**
 * The `operations` profile (internal staff, web only) may use the release queue, the data refresh and logout, nothing else.
 * Convenience for the client (menu, route guard, which requests to skip); the server enforces it and answers 403 otherwise.
 */
export function isOperationsRole(role: string | undefined): boolean {
  return role === "operations";
}

/** The only page of the `operations` profile. */
export const OPERATIONS_HOME = "/aguardando-liberacao";
