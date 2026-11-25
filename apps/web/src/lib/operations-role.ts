/**
 * The `operations` profile (internal staff, web only) may use the release queue, its own profile (photo) and logout, nothing else.
 * Convenience for the client (menu, route guard, which requests to skip); the server enforces it and answers 403 otherwise.
 */
export function isOperationsRole(role: string | undefined): boolean {
  return role === "operations";
}

/** The home page of the `operations` profile. */
export const OPERATIONS_HOME = "/aguardando-liberacao";

/** The other page it may open: "Meu perfil", for its own photo (no sync block). */
export const OPERATIONS_PROFILE = "/perfil";
