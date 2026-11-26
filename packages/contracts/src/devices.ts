import { z } from 'zod';
import { IsoTimestampSchema, UuidSchema, named } from './primitives.js';

/**
 * Mobile devices (AUTH-2, RF-IAM-7/8, W-36, M-02/M-18/M-19). The app registers its installation at login; a pending device
 * receives no business data; a revoked one is told to wipe its local database on its next contact.
 */
export const DeviceStatusSchema = named('DeviceStatus', z.enum(['pending', 'approved', 'revoked']));
export type DeviceStatusValue = z.infer<typeof DeviceStatusSchema>;

export const DevicePlatformSchema = named('DevicePlatform', z.enum(['android', 'ios']));

/** Sent by the app inside the login body. `installId` is a random id kept in the secure store (never a hardware id). */
export const DeviceRegistrationSchema = named(
  'DeviceRegistration',
  z.strictObject({
    installId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
    label: z.string().trim().min(1).max(80),
    platform: DevicePlatformSchema,
  }),
);
export type DeviceRegistration = z.infer<typeof DeviceRegistrationSchema>;

/** The device as the session reports it back to the app. */
export const SessionDeviceSchema = named(
  'SessionDevice',
  z.object({
    id: UuidSchema,
    status: DeviceStatusSchema,
    /** Days the app may stay without a synchronization (configurable in Configuracoes; RF-IAM-8). */
    offlineMaxDays: z.number().int().min(1).max(60),
    /** Price table of a customer without one (AD_FORCECFG, registered in the ERP; 5 when not filled in). */
    defaultPriceTableCode: z.number().int().min(0).optional(),
  }),
);
export type SessionDevice = z.infer<typeof SessionDeviceSchema>;

/** `GET /devices/me` - own device status; the app polls it while pending. 401 `device_revoked` = wipe. */
export const MyDeviceResponseSchema = named('MyDeviceResponse', z.object({ device: SessionDeviceSchema.nullable() }));
export type MyDeviceResponse = z.infer<typeof MyDeviceResponseSchema>;

/** `POST /devices/me/sync` - the app reports a completed synchronization (informational for W-36). */
export const DeviceSyncReportSchema = named('DeviceSyncReport', z.strictObject({ syncedAt: IsoTimestampSchema }));

export const DeviceViewSchema = named(
  'DeviceView',
  z.object({
    id: UuidSchema,
    accountId: UuidSchema,
    accountName: z.string(),
    accountUsername: z.string(),
    label: z.string(),
    platform: DevicePlatformSchema,
    status: DeviceStatusSchema,
    createdAt: IsoTimestampSchema,
    lastSeenAt: IsoTimestampSchema,
    lastSyncAt: IsoTimestampSchema.nullable(),
    decidedAt: IsoTimestampSchema.nullable(),
    decidedByName: z.string().nullable(),
    /** The caller may approve or revoke this device (admin: any; manager: own team). */
    canManage: z.boolean(),
  }),
);
export type DeviceView = z.infer<typeof DeviceViewSchema>;

export const DevicesQuerySchema = z.object({ status: DeviceStatusSchema.optional() });
export const DevicesResponseSchema = named('DevicesResponse', z.object({ items: z.array(DeviceViewSchema) }));
export type DevicesResponse = z.infer<typeof DevicesResponseSchema>;

export const DevicePathSchema = z.object({ id: UuidSchema });

export const DeviceSettingsSchema = named(
  'DeviceSettings',
  z.strictObject({
    offlineMaxDays: z.number().int().min(1).max(60),
    maxActiveDevices: z.number().int().min(1).max(5),
  }),
);
export type DeviceSettings = z.infer<typeof DeviceSettingsSchema>;

/** `PUT /device-settings`: only the approved-devices limit is edited in the Force; the offline days come from the ERP (AD_FORCECFG, read-only). */
export const UpdateDeviceSettingsRequestSchema = named(
  'UpdateDeviceSettingsRequest',
  z.strictObject({ maxActiveDevices: z.number().int().min(1).max(5) }),
);
export type UpdateDeviceSettingsRequest = z.infer<typeof UpdateDeviceSettingsRequestSchema>;
