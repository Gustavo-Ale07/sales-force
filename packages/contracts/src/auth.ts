import { z } from 'zod';
import { IsoTimestampSchema, UuidSchema, codeInt, named } from './primitives.js';

export const AccountRoleSchema = named('AccountRole', z.enum(['admin', 'manager', 'seller', 'technical', 'operations']));
export type AccountRole = z.infer<typeof AccountRoleSchema>;

/**
 * `dev`: isolated development authentication, never production. `local`: Force-local Argon2id login
 * restricted to the admin and technical profiles (AUTH-5, ROLE-1; valid in production; operational
 * accounts are refused until an external verifier mode exists).
 */
export const AuthModeSchema = named('AuthMode', z.enum(['dev', 'local', 'external']));
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
    /**
     * Which client is signing in. The mobile app sends `app`; omitted means the site. Profiles without mobile use
     * (`technical`, `operations`) are refused on `app` with `app_not_permitted` AFTER the credentials were proven
     * (so the refusal reveals nothing to someone without the password). The site is never affected.
     */
    client: z.enum(['web', 'app']).optional(),
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
    /** Opaque version of the account's profile photo (cache key: `GET /me/photo?v=<photoVersion>`), or null/absent when there is none. Additive: older clients ignore it. */
    photoVersion: z.string().min(1).max(64).nullable().optional(),
  }),
);
export type Account = z.infer<typeof AccountSchema>;

/** Photo formats accepted on upload (checked against the file's magic bytes, never only the declared type). */
export const PHOTO_UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Largest decoded upload (5 MiB); the request carries it base64-encoded. */
export const PHOTO_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
/** Base64 length of the largest upload, plus the JSON envelope. */
export const PHOTO_UPLOAD_MAX_BODY_BYTES = Math.ceil((PHOTO_UPLOAD_MAX_BYTES * 4) / 3) + 4096;

/**
 * Optional crop rectangle in PIXELS of the uploaded image after its EXIF orientation is applied (what the user sees).
 * The server crops it, then squares it from the centre; absent = centre square of the whole image.
 */
export const PhotoCropSchema = named(
  'PhotoCrop',
  z.strictObject({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
  }),
);

export const PutProfilePhotoRequestSchema = named(
  'PutProfilePhotoRequest',
  z.strictObject({
    contentType: z.enum(PHOTO_UPLOAD_CONTENT_TYPES),
    /** The image file, standard base64 (no data: prefix). Up to 5 MiB decoded. */
    dataBase64: z.string().min(1).max(Math.ceil((PHOTO_UPLOAD_MAX_BYTES * 4) / 3) + 4),
    crop: PhotoCropSchema.optional(),
  }),
);
export type PutProfilePhotoRequest = z.infer<typeof PutProfilePhotoRequestSchema>;

export const ProfilePhotoSchema = named(
  'ProfilePhoto',
  z.object({
    /** Cache key of the stored rendition; changes whenever the photo changes. */
    version: z.string().min(1).max(64),
    /** The stored rendition is always a square WebP of at most 512 px. */
    contentType: z.literal('image/webp'),
    sizePx: z.number().int().min(1),
    updatedAt: IsoTimestampSchema,
  }),
);
export type ProfilePhoto = z.infer<typeof ProfilePhotoSchema>;

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
