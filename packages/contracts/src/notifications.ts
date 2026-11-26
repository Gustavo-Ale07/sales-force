import { z } from 'zod';
import { IsoTimestampSchema, UuidSchema, named } from './primitives.js';

/** Central de notificações (RF-NOT-1/2) e registro do aparelho para push. Never carries cost, margin or foreign data. */

export const NotificationCategorySchema = z.enum(['order', 'customer', 'task']);

export const NotificationSchema = named(
  'Notification',
  z.object({
    id: UuidSchema,
    category: NotificationCategorySchema,
    title: z.string(),
    body: z.string(),
    refType: z.enum(['order', 'customer_registration', 'task']),
    refId: z.string(),
    readAt: IsoTimestampSchema.nullable(),
    createdAt: IsoTimestampSchema,
  }),
);
export type NotificationItem = z.infer<typeof NotificationSchema>;

export const NotificationsQuerySchema = z.object({
  unreadOnly: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type NotificationsQuery = z.infer<typeof NotificationsQuerySchema>;

export const NotificationsResponseSchema = named(
  'NotificationsResponse',
  z.object({ items: z.array(NotificationSchema), unreadCount: z.number().int().min(0) }),
);
export type NotificationsResponse = z.infer<typeof NotificationsResponseSchema>;

/** Omitted `ids` = mark every notification of the caller as read. */
export const MarkNotificationsReadRequestSchema = named(
  'MarkNotificationsReadRequest',
  z.strictObject({ ids: z.array(UuidSchema).min(1).max(200).optional() }),
);
export type MarkNotificationsReadRequest = z.infer<typeof MarkNotificationsReadRequestSchema>;

export const UnreadCountResponseSchema = named('UnreadCountResponse', z.object({ unreadCount: z.number().int().min(0) }));
export type UnreadCountResponse = z.infer<typeof UnreadCountResponseSchema>;

export const RegisterPushDeviceRequestSchema = named(
  'RegisterPushDeviceRequest',
  z.strictObject({
    token: z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$/, 'Token de push inválido'),
    platform: z.enum(['android', 'ios']),
  }),
);
export type RegisterPushDeviceRequest = z.infer<typeof RegisterPushDeviceRequestSchema>;

export const UnregisterPushDeviceRequestSchema = named(
  'UnregisterPushDeviceRequest',
  z.strictObject({ token: z.string().min(10).max(200) }),
);
export type UnregisterPushDeviceRequest = z.infer<typeof UnregisterPushDeviceRequestSchema>;
