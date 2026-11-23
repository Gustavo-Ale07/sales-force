import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORDER_STAGE_RULES,
  ORDER_STAGE_CODES,
  ORDER_STAGE_LABELS,
  ORDER_STAGE_TIMELINE,
  classifyOrderStage,
  isOrderStageDue,
  releaseQueueSectors,
  resolveOrderStageRules,
  sectorsOfPendingRelease,
  visibleReleaseQueueSectors,
  type OrderStageFacts,
  type OrderStageRules,
} from '../src/index.js';

const base: OrderStageFacts = {
  nunota: 2506,
  codtipoper: 1001,
  statusnota: 'A',
  pendente: 'S',
  ordemcarga: 0,
  pendingReleases: [],
  hasInvoiceLink: false,
  invoiceNumber: null,
  isQuotation: false,
};
const facts = (patch: Partial<OrderStageFacts>): OrderStageFacts => ({ ...base, ...patch });

describe('classifyOrderStage (owner survey 2026-11-23)', () => {
  it.each<[string, Partial<OrderStageFacts>, string]>([
    ['no pending line, not confirmed', {}, 'received'],
    ['null ordemcarga is not a load order', { ordemcarga: null }, 'received'],
    ['event 44 at cascade 1', { pendingReleases: [{ event: 44, cascadeSequence: 1 }] }, 'in_review'],
    ['event 44 at cascade 2', { pendingReleases: [{ event: 44, cascadeSequence: 2 }] }, 'financial_check'],
    ['event 44 without cascade', { pendingReleases: [{ event: 44, cascadeSequence: null }] }, 'financial_check'],
    ['event 2 at any cascade', { pendingReleases: [{ event: 2, cascadeSequence: 9 }] }, 'in_review'],
    ['event 2 without cascade', { pendingReleases: [{ event: 2, cascadeSequence: null }] }, 'in_review'],
    ['event 3', { pendingReleases: [{ event: 3, cascadeSequence: null }] }, 'financial_check'],
    ['event 13', { pendingReleases: [{ event: 13, cascadeSequence: null }] }, 'financial_check'],
    ['confirmed note, no pending line', { statusnota: 'L' }, 'in_dispatch'],
    ['load order > 0', { statusnota: 'L', ordemcarga: 7 }, 'in_invoicing'],
    ['invoicing link', { statusnota: 'L', hasInvoiceLink: true, invoiceNumber: 5001 }, 'invoiced'],
    ['invoicing link without a readable number is still invoiced', { hasInvoiceLink: true }, 'invoiced'],
  ])('%s -> %s', (_name, patch, expected) => {
    expect(classifyOrderStage(facts(patch)).code).toBe(expected);
  });

  it('precedence: invoicing link beats load order, pending releases and confirmation', () => {
    const stage = classifyOrderStage(facts({ hasInvoiceLink: true, ordemcarga: 3, statusnota: 'L', pendingReleases: [{ event: 44, cascadeSequence: 1 }] }));
    expect(stage.code).toBe('invoiced');
    expect(stage.final).toBe(true);
  });

  it('precedence: load order beats pending releases', () => {
    expect(classifyOrderStage(facts({ ordemcarga: 1, pendingReleases: [{ event: 44, cascadeSequence: 1 }] })).code).toBe('in_invoicing');
  });

  it('precedence: a pending review event beats a pending financial line, and any pending line beats confirmation', () => {
    expect(classifyOrderStage(facts({ pendingReleases: [{ event: 3, cascadeSequence: null }, { event: 44, cascadeSequence: 1 }] })).code).toBe('in_review');
    expect(classifyOrderStage(facts({ statusnota: 'L', pendingReleases: [{ event: 3, cascadeSequence: null }] })).code).toBe('financial_check');
  });

  it('carries the pending sector only for review and financial check', () => {
    expect(classifyOrderStage(facts({ pendingReleases: [{ event: 44, cascadeSequence: 1 }] })).pendingSector).toBe('Pedidos');
    expect(classifyOrderStage(facts({ pendingReleases: [{ event: 3, cascadeSequence: null }] })).pendingSector).toBe('Financeiro');
    expect(classifyOrderStage(facts({})).pendingSector).toBeNull();
    expect(classifyOrderStage(facts({ statusnota: 'L' })).pendingSector).toBeNull();
  });

  it('only the invoiced stage is final; labels exist for every code', () => {
    for (const code of ORDER_STAGE_CODES) expect(ORDER_STAGE_LABELS[code].length).toBeGreaterThan(0);
    expect(classifyOrderStage(facts({ hasInvoiceLink: true })).final).toBe(true);
    expect(classifyOrderStage(facts({ statusnota: 'L' })).final).toBe(false);
  });

  it('a quotation note skips the cascade and has no timeline', () => {
    const stage = classifyOrderStage(facts({ isQuotation: true, hasInvoiceLink: true, ordemcarga: 4, pendingReleases: [{ event: 44, cascadeSequence: 1 }] }));
    expect(stage.code).toBe('quotation');
    expect(stage.hasTimeline).toBe(false);
  });

  it('no note yet: sent_to_force, or send_error when the outbox row failed', () => {
    expect(classifyOrderStage(facts({ nunota: null })).code).toBe('sent_to_force');
    expect(classifyOrderStage(facts({ nunota: null, outboxState: 'pending' })).code).toBe('sent_to_force');
    expect(classifyOrderStage(facts({ nunota: null, outboxState: null })).code).toBe('sent_to_force');
    expect(classifyOrderStage(facts({ nunota: null, outboxState: 'failed' })).code).toBe('send_error');
  });

  it('the outbox state is ignored once a note exists', () => {
    expect(classifyOrderStage(facts({ outboxState: 'failed' })).code).toBe('received');
  });

  it('the failed-outbox state does not turn a quotation or an invoiced order into an error', () => {
    expect(classifyOrderStage(facts({ outboxState: 'failed', hasInvoiceLink: true })).code).toBe('invoiced');
  });

  it('uses the configured rules, not literals', () => {
    const rules: OrderStageRules = { ...DEFAULT_ORDER_STAGE_RULES, reviewEvents: [{ event: 99 }], reviewSector: 'Comercial', financialSector: 'Caixa' };
    const review = classifyOrderStage(facts({ pendingReleases: [{ event: 99, cascadeSequence: 5 }] }), rules);
    expect(review).toMatchObject({ code: 'in_review', pendingSector: 'Comercial' });
    // event 44 is no longer a review event under this configuration
    const money = classifyOrderStage(facts({ pendingReleases: [{ event: 44, cascadeSequence: 1 }] }), rules);
    expect(money).toMatchObject({ code: 'financial_check', pendingSector: 'Caixa' });
  });

  it('is pure: the same facts give the same stage and the input is not mutated', () => {
    const input = facts({ pendingReleases: [{ event: 44, cascadeSequence: 1 }] });
    const frozen = JSON.stringify(input);
    expect(classifyOrderStage(input)).toEqual(classifyOrderStage(input));
    expect(JSON.stringify(input)).toBe(frozen);
  });
});

describe('ORDER_STAGE_TIMELINE', () => {
  it('lists the followed stages in order and excludes quotation and Force-side states', () => {
    expect(ORDER_STAGE_TIMELINE).toEqual(['received', 'in_review', 'financial_check', 'in_dispatch', 'in_invoicing', 'invoiced']);
    for (const code of ['quotation', 'sent_to_force', 'send_error'] as const) expect(ORDER_STAGE_TIMELINE).not.toContain(code);
  });
});

describe('resolveOrderStageRules', () => {
  it('returns the defaults when nothing is configured', () => {
    expect(resolveOrderStageRules()).toEqual(DEFAULT_ORDER_STAGE_RULES);
    expect(resolveOrderStageRules({})).toEqual(DEFAULT_ORDER_STAGE_RULES);
  });

  it('default values are the PLAC survey values', () => {
    expect(DEFAULT_ORDER_STAGE_RULES.reviewEvents).toEqual([{ event: 44, cascadeSequence: 1 }, { event: 2 }]);
    expect(DEFAULT_ORDER_STAGE_RULES.bothSectorsEvents).toEqual([13]);
    expect(DEFAULT_ORDER_STAGE_RULES.finalRereadWindowHours).toBe(24);
  });

  it('overrides only the configured keys', () => {
    const rules = resolveOrderStageRules({ finalRereadWindowHours: 0, reviewSector: 'Revisao' });
    expect(rules.finalRereadWindowHours).toBe(0);
    expect(rules.reviewSector).toBe('Revisao');
    expect(rules.financialSector).toBe('Financeiro');
    expect(rules.reviewEvents).toEqual(DEFAULT_ORDER_STAGE_RULES.reviewEvents);
    expect(rules.bothSectorsEvents).toEqual([13]);
  });

  it('keeps an explicitly empty list (not the default)', () => {
    expect(resolveOrderStageRules({ bothSectorsEvents: [] }).bothSectorsEvents).toEqual([]);
    expect(resolveOrderStageRules({ reviewEvents: [] }).reviewEvents).toEqual([]);
  });
});

describe('isOrderStageDue', () => {
  const rules = resolveOrderStageRules();
  const now = new Date('2026-11-23T12:00:00Z');
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3600_000);

  it('is due when never read', () => {
    expect(isOrderStageDue(null, null, now, rules)).toBe(true);
    expect(isOrderStageDue('received', null, now, rules)).toBe(true);
    expect(isOrderStageDue(null, hoursAgo(1), now, rules)).toBe(true);
  });

  it('is always due for a non-final stage', () => {
    for (const code of ORDER_STAGE_CODES.filter((candidate) => candidate !== 'invoiced')) expect(isOrderStageDue(code, hoursAgo(1000), now, rules)).toBe(true);
  });

  it('an invoiced order is read only inside the window (boundary excluded)', () => {
    expect(isOrderStageDue('invoiced', hoursAgo(23.99), now, rules)).toBe(true);
    expect(isOrderStageDue('invoiced', hoursAgo(24), now, rules)).toBe(false);
    expect(isOrderStageDue('invoiced', hoursAgo(100), now, rules)).toBe(false);
  });

  it('window 0 means never read again once invoiced', () => {
    expect(isOrderStageDue('invoiced', now, now, { ...rules, finalRereadWindowHours: 0 })).toBe(false);
  });

  it('honours a configured window', () => {
    expect(isOrderStageDue('invoiced', hoursAgo(47), now, { ...rules, finalRereadWindowHours: 48 })).toBe(true);
    expect(isOrderStageDue('invoiced', hoursAgo(49), now, { ...rules, finalRereadWindowHours: 48 })).toBe(false);
  });
});

describe('sectorsOfPendingRelease (release queue)', () => {
  const rules = resolveOrderStageRules();

  it('event 13 appears in both sectors (default configuration)', () => {
    expect(sectorsOfPendingRelease({ event: 13, cascadeSequence: null }, rules)).toEqual(['Pedidos', 'Financeiro']);
    expect(sectorsOfPendingRelease({ event: 13, cascadeSequence: 4 }, rules)).toEqual(['Pedidos', 'Financeiro']);
  });

  it('review events go to the review sector only, others to the financial sector only', () => {
    expect(sectorsOfPendingRelease({ event: 44, cascadeSequence: 1 }, rules)).toEqual(['Pedidos']);
    expect(sectorsOfPendingRelease({ event: 2, cascadeSequence: null }, rules)).toEqual(['Pedidos']);
    expect(sectorsOfPendingRelease({ event: 44, cascadeSequence: 2 }, rules)).toEqual(['Financeiro']);
    expect(sectorsOfPendingRelease({ event: 3, cascadeSequence: null }, rules)).toEqual(['Financeiro']);
  });

  it('uses the configured sectors and both-sector events', () => {
    const custom = resolveOrderStageRules({ reviewSector: 'A', financialSector: 'B', bothSectorsEvents: [77], reviewEvents: [{ event: 5 }] });
    expect(sectorsOfPendingRelease({ event: 77, cascadeSequence: null }, custom)).toEqual(['A', 'B']);
    expect(sectorsOfPendingRelease({ event: 13, cascadeSequence: null }, custom)).toEqual(['B']);
    expect(sectorsOfPendingRelease({ event: 5, cascadeSequence: null }, custom)).toEqual(['A']);
  });

  it('with no both-sector events, event 13 is a plain financial line', () => {
    expect(sectorsOfPendingRelease({ event: 13, cascadeSequence: null }, resolveOrderStageRules({ bothSectorsEvents: [] }))).toEqual(['Financeiro']);
  });

  it('never repeats a sector when review and financial sectors have the same name', () => {
    const same = resolveOrderStageRules({ reviewSector: 'X', financialSector: 'X' });
    expect(sectorsOfPendingRelease({ event: 13, cascadeSequence: null }, same)).toEqual(['X']);
  });
});

describe('releaseQueueSectors / visibleReleaseQueueSectors (deny by default)', () => {
  const rules = resolveOrderStageRules();
  const sectors = releaseQueueSectors(rules);
  const sectorUsers = { Pedidos: [120, 121], Financeiro: [130] };

  it('knows the review and financial sectors', () => {
    expect(sectors).toEqual(['Pedidos', 'Financeiro']);
    expect(releaseQueueSectors({ reviewSector: 'X', financialSector: 'X' })).toEqual(['X']);
  });

  it('admin and manager see every sector without configuration', () => {
    expect(visibleReleaseQueueSectors({ role: 'admin' }, sectors, undefined)).toEqual(sectors);
    expect(visibleReleaseQueueSectors({ role: 'manager', externalUserId: null }, sectors, {})).toEqual(sectors);
  });

  it('a seller sees only the sectors whose list holds its Sankhya user code', () => {
    expect(visibleReleaseQueueSectors({ role: 'seller', externalUserId: '120' }, sectors, sectorUsers)).toEqual(['Pedidos']);
    expect(visibleReleaseQueueSectors({ role: 'seller', externalUserId: '130' }, sectors, sectorUsers)).toEqual(['Financeiro']);
    expect(visibleReleaseQueueSectors({ role: 'seller', externalUserId: '130' }, sectors, { Pedidos: [130], Financeiro: [130] })).toEqual(sectors);
  });

  it('a seller not listed, without a code, with a malformed code or with no configuration sees nothing', () => {
    expect(visibleReleaseQueueSectors({ role: 'seller', externalUserId: '999' }, sectors, sectorUsers)).toEqual([]);
    expect(visibleReleaseQueueSectors({ role: 'seller', externalUserId: null }, sectors, sectorUsers)).toEqual([]);
    expect(visibleReleaseQueueSectors({ role: 'seller' }, sectors, sectorUsers)).toEqual([]);
    expect(visibleReleaseQueueSectors({ role: 'seller', externalUserId: '12x' }, sectors, sectorUsers)).toEqual([]);
    expect(visibleReleaseQueueSectors({ role: 'seller', externalUserId: '0120' }, sectors, sectorUsers)).toEqual([]);
    expect(visibleReleaseQueueSectors({ role: 'seller', externalUserId: '120' }, sectors, undefined)).toEqual([]);
    expect(visibleReleaseQueueSectors({ role: 'seller', externalUserId: '120' }, sectors, {})).toEqual([]);
  });

  it('a sector name that is an Object.prototype key never grants access', () => {
    expect(visibleReleaseQueueSectors({ role: 'seller', externalUserId: '120' }, ['constructor', 'toString'], sectorUsers)).toEqual([]);
  });

  it('technical, representative and unknown roles never see the queue, even when listed', () => {
    for (const role of ['technical', 'representative', 'external_representative', 'director', '']) {
      expect(visibleReleaseQueueSectors({ role, externalUserId: '120' }, sectors, sectorUsers)).toEqual([]);
    }
  });
});
