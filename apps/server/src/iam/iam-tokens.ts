/** Dependency-injection tokens of the identity module. */
export const AUTH_CONFIG = Symbol('AUTH_CONFIG');
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
/** Optional: absent in every runtime today. `AuthService.loginExternal` fails closed without them. */
export const EXTERNAL_IDENTITY_VERIFIER = Symbol('EXTERNAL_IDENTITY_VERIFIER');
export const EXTERNAL_ACCOUNT_LINKS = Symbol('EXTERNAL_ACCOUNT_LINKS');
