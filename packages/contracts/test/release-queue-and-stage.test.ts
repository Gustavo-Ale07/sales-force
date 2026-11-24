import { ORDER_STAGE_CODES } from '@salesforce/domain';
import { describe, expect, it } from 'vitest';
import {
  InstallationConfigurationSchema,
  OrderListItemSchema,
  OrderStageCodeSchema,
  OrdersQuerySchema,
  ReleaseQueueCountQuerySchema,
  ReleaseQueueCountResponseSchema,
  ReleaseQueueItemSchema,
  ReleaseQueueQuerySchema,
  ReleaseQueueResponseSchema,
} from '../src/index.js';
import { makeConfig } from './fixtures.js';

const uuid = '0190a3f0-7b1c-7000-8000-000000000001';
const iso = '2030-01-01T10:00:00.000Z';

const item = {
  nunota: 2506,
  orderId: uuid,
  draftNumber: 12,
  sector: 'Pedidos',
  event: 44,
  cascadeSequence: 1,
  eventLabel: 'Revisao',
  customerCode: 500,
  customerName: 'Cliente Teste',
  sellerCode: 900,
  sellerName: 'Vendedor Teste',
  estimatedTotal: '100.00',
  topCode: 4101,
  orderedAt: iso,
  waitingSince: iso,
  waitingSinceSource: 'order_time',
  waitingMinutes: 5,
  firstSeenAt: iso,
  assignedUserCode: null,
  checkedAt: iso,
};

describe('release queue contracts', () => {
  it('accepts a complete item and a paginated response', () => {
    expect(ReleaseQueueItemSchema.safeParse(item).success).toBe(true);
    expect(ReleaseQueueResponseSchema.safeParse({ items: [item], page: 1, pageSize: 20, total: 1 }).success).toBe(true);
  });

  it.each([
    ['nunota below 1', { nunota: 0 }],
    ['non-uuid orderId', { orderId: 'x' }],
    ['unknown waitingSinceSource', { waitingSinceSource: 'guess' }],
    ['negative waitingMinutes', { waitingMinutes: -1 }],
    ['fractional waitingMinutes', { waitingMinutes: 1.5 }],
    ['non-decimal estimatedTotal', { estimatedTotal: 'abc' }],
    ['numeric (float) estimatedTotal', { estimatedTotal: 10.5 }],
    ['missing checkedAt', { checkedAt: undefined }],
    ['non-ISO waitingSince', { waitingSince: 'yesterday' }],
  ])('rejects %s', (_name, patch) => {
    expect(ReleaseQueueItemSchema.safeParse({ ...item, ...patch }).success).toBe(false);
  });

  it('item accepts nullable seller, cascade, event label, assignee and TOP', () => {
    const parsed = ReleaseQueueItemSchema.safeParse({ ...item, sellerCode: null, sellerName: null, cascadeSequence: null, eventLabel: null, assignedUserCode: null, topCode: null });
    expect(parsed.success).toBe(true);
  });

  it('item has no cost or margin field (P-20): nothing sensitive in the declared shape', () => {
    const keys = Object.keys(ReleaseQueueItemSchema.shape);
    expect(keys.filter((key) => /cost|margin|margem|secret|token|^custo$/i.test(key))).toEqual([]);
  });

  it('query: defaults, coerces numbers, rejects bad ones', () => {
    const parsed = ReleaseQueueQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(ReleaseQueueQuerySchema.parse({ sector: 'Financeiro', sellerCode: '900', assignedUserCode: '120' })).toMatchObject({ sector: 'Financeiro', sellerCode: 900, assignedUserCode: 120 });
    expect(ReleaseQueueQuerySchema.safeParse({ sector: '' }).success).toBe(false);
    expect(ReleaseQueueQuerySchema.safeParse({ sector: 'x'.repeat(61) }).success).toBe(false);
    expect(ReleaseQueueQuerySchema.safeParse({ sellerCode: 'abc' }).success).toBe(false);
    expect(ReleaseQueueQuerySchema.safeParse({ sellerCode: '-1' }).success).toBe(false);
  });

  it('count query and response', () => {
    expect(ReleaseQueueCountQuerySchema.safeParse({}).success).toBe(true);
    expect(ReleaseQueueCountQuerySchema.safeParse({ sector: '' }).success).toBe(false);
    expect(ReleaseQueueCountResponseSchema.safeParse({ total: 2, sectors: [{ sector: 'Pedidos', count: 2 }], lastCheckedAt: iso }).success).toBe(true);
    expect(ReleaseQueueCountResponseSchema.safeParse({ total: 0, sectors: [], lastCheckedAt: null }).success).toBe(true);
    expect(ReleaseQueueCountResponseSchema.safeParse({ total: -1, sectors: [], lastCheckedAt: null }).success).toBe(false);
    expect(ReleaseQueueCountResponseSchema.safeParse({ total: 1, sectors: [{ sector: 'P', count: -1 }], lastCheckedAt: null }).success).toBe(false);
  });
});

describe('erpStage on the order list DTO', () => {
  const stageSchema = OrderListItemSchema.shape.erpStage;
  const stage = { stage: 'in_review', label: 'Em revisão', pendingSector: 'Pedidos', nunota: 2506, invoiceNumber: null, updatedAt: iso };

  it('accepts a minimal stage, the optional checkedAt / readError, and null / absent', () => {
    expect(stageSchema.safeParse(stage).success).toBe(true);
    expect(stageSchema.safeParse({ ...stage, checkedAt: iso, readError: { errorClass: 'temporary', errorCode: 'erp_unavailable', at: iso } }).success).toBe(true);
    expect(stageSchema.safeParse({ ...stage, checkedAt: null, readError: null }).success).toBe(true);
    expect(stageSchema.safeParse(null).success).toBe(true);
    expect(stageSchema.safeParse(undefined).success).toBe(true);
  });

  it('the contract stage codes equal the domain ORDER_STAGE_CODES; the orders query filters by them only', () => {
    expect([...OrderStageCodeSchema.options].sort()).toEqual([...ORDER_STAGE_CODES].sort());
    expect(OrdersQuerySchema.safeParse({ stage: 'in_review' }).success).toBe(true);
    expect(OrdersQuerySchema.safeParse({}).success).toBe(true);
    expect(OrdersQuerySchema.safeParse({ stage: 'draft' }).success).toBe(false);
  });

  it.each(['sent_to_force', 'send_error', 'quotation', 'received', 'in_review', 'financial_check', 'in_dispatch', 'in_invoicing', 'invoiced', 'barred'])('accepts stage %s', (code) => {
    expect(stageSchema.safeParse({ ...stage, stage: code }).success).toBe(true);
  });

  it.each([
    ['unknown stage code', { stage: 'shipped' }],
    ['missing updatedAt', { updatedAt: undefined }],
    ['non-integer nunota', { nunota: 1.5 }],
    ['malformed readError', { readError: { errorClass: 'x' } }],
  ])('rejects %s', (_name, patch) => {
    expect(stageSchema.safeParse({ ...stage, ...patch }).success).toBe(false);
  });
});

describe('configuration erp.orderStage / erp.releaseQueue', () => {
  const withErp = (erp: Record<string, unknown>) => makeConfig((c) => ({ ...c, erp: { ...(c.erp ?? {}), ...erp } as never }));
  const ok = (erp: Record<string, unknown>) => InstallationConfigurationSchema.safeParse(withErp(erp)).success;

  it('accepts a full orderStage and releaseQueue block and an empty one', () => {
    expect(ok({ orderStage: {} })).toBe(true);
    expect(
      ok({
        orderStage: {
          reviewEvents: [{ event: 44, cascadeSequence: 1 }, { event: 2 }],
          reviewSector: 'Pedidos',
          financialSector: 'Financeiro',
          finalRereadWindowHours: 24,
          bothSectorsEvents: [13],
        },
        releaseQueue: { sectorUsers: { Pedidos: [120], Financeiro: [130, 131] } },
      }),
    ).toBe(true);
    expect(ok({ releaseQueue: {} })).toBe(true);
  });

  it.each([
    ['unknown orderStage key', { orderStage: { surprise: 1 } }],
    ['negative window', { orderStage: { finalRereadWindowHours: -1 } }],
    ['window above 720 h', { orderStage: { finalRereadWindowHours: 721 } }],
    ['fractional window', { orderStage: { finalRereadWindowHours: 1.5 } }],
    ['empty reviewSector', { orderStage: { reviewSector: '' } }],
    ['too-long financialSector', { orderStage: { financialSector: 'x'.repeat(61) } }],
    ['review event as a bare number', { orderStage: { reviewEvents: [44] } }],
    ['review event with an unknown key', { orderStage: { reviewEvents: [{ event: 44, other: 1 }] } }],
    ['bothSectorsEvents not numbers', { orderStage: { bothSectorsEvents: ['13'] } }],
    ['unknown releaseQueue key', { releaseQueue: { everyone: true } }],
    ['sector users not numbers', { releaseQueue: { sectorUsers: { Pedidos: ['abc'] } } }],
    ['empty sector name', { releaseQueue: { sectorUsers: { '': [1] } } }],
    ['sector users above 200', { releaseQueue: { sectorUsers: { Pedidos: Array.from({ length: 201 }, (_, i) => i + 1) } } }],
  ])('rejects %s', (_name, erp) => {
    expect(ok(erp)).toBe(false);
  });

  it('the configuration without these blocks stays valid (backward compatible)', () => {
    expect(InstallationConfigurationSchema.safeParse(makeConfig()).success).toBe(true);
  });
});
