import { z } from 'zod';
import { IsoTimestampSchema, UuidSchema, codeInt, named } from './primitives.js';

export const AccountRoleSchema = named('AccountRole', z.enum(['admin', 'manager', 'seller', 'technical']));
export type AccountRole = z.infer<typeof AccountRoleSchema>;

/**
 * `dev`: isolated development authentication, never production. `local`: Force-local Argon2id login
 * restricted to the admin and technical profiles (AUTH-5, ROLE-1; valid in production; operational
 * accounts are refused until an external verifier mode exists).
 */
export const AuthModeSchema = named('AuthMode', z.enum(['dev', 'local']));
export type AuthMode = z.infer<typeof AuthModeSchema>;

/**
 * Login request. `password` is the only credential-like field allowed anywhere in the contracts
 * (P-22); it is request-only and never appears in a response or a log.
 */
export const LoginRequestSchema = named(
  'LoginRequest',
  z.strictObject({
    /** Login name (Sankhya user or a local admin/technical identifier). Trimmed only: no e-mail format, no case change. */
    username: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(256),
  }),
);
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const AccountSchema = named(
  'Account',
  z.object({
    id: UuidSchema,
    /** The account's login identifier (user name; not an e-mail address: no format check). Opaque `sankhya:<id>` for handles created from the ERP directory. */
    username: z.string().min(1),
    displayName: z.string(),
    role: AccountRoleSchema,
    /** Seller codes linked to the account by configuration (CFG-2). Empty for accounts without links. */
    sellerCodes: z.array(codeInt()),
  }),
);
export type Account = z.infer<typeof AccountSchema>;

export const AuthenticatedSessionSchema = named(
  'AuthenticatedSession',
  z.object({
    authenticated: z.literal(true),
    authMode: AuthModeSchema,
    account: AccountSchema,
    expiresAt: IsoTimestampSchema,
  }),
);

export const AnonymousSessionSchema = named(
  'AnonymousSession',
  z.object({
    authenticated: z.literal(false),
    /** Lets the login page show the development-authentication banner before signing in. */
    authMode: AuthModeSchema,
  }),
);

/** `GET /auth/session` answers 200 for both cases so the SPA can probe without error noise. */
export const SessionResponseSchema = named(
  'SessionResponse',
  z.discriminatedUnion('authenticated', [AuthenticatedSessionSchema, AnonymousSessionSchema]),
);
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

/** Login success: the session cookie is set by the server (HttpOnly); the body carries no token. */
export const LoginResponseSchema = AuthenticatedSessionSchema;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
