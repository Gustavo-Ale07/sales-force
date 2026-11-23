import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyOrderStage } from '@salesforce/domain';
import { FakeGateway, FakeOrderBook, RealSankhyaGateway, Secret, SankhyaGatewayError, getDemoDataset } from '../src/index.js';
import { MockSankhya, TEST_CREDENTIALS, erpTablesFromDataset, httpStatus, ok, type ClockRef } from './support/mock-sankhya.js';

const HEADER_COLUMNS = ['NUNOTA', 'CODTIPOPER', 'STATUSNOTA', 'PENDENTE', 'ORDEMCARGA'];
const RELEASE_COLUMNS = ['NUCHAVE', 'EVENTO', 'SEQCASCATA'];
const ASSIGNEE_COLUMNS = ['NUCHAVE', 'EVENTO', 'SEQCASCATA', 'CODUSULIB'];
const LINK_COLUMNS = ['NUNOTAORIG', 'NUNOTA'];
const NUMBER_COLUMNS = ['NUNOTA', 'NUMNOTA'];

function setup() {
  const clock: ClockRef = { now: 1_800_000_000_000 };
  const mock = new MockSankhya({ tables: erpTablesFromDataset(getDemoDataset()), clock });
  const gateway = new RealSankhyaGateway({
    baseUrl: 'https://api.sandbox.sankhya.com.br',
    allowedHosts: ['api.sandbox.sankhya.com.br'],
    environmentKind: 'sandbox',
    credentials: {
      clientId: new Secret(TEST_CREDENTIALS.clientId),
      clientSecret: new Secret(TEST_CREDENTIALS.clientSecret),
      xToken: new Secret(TEST_CREDENTIALS.xToken),
    },
    transport: mock.transport,
    now: () => clock.now,
  });
  return { gateway, mock };
}

describe('RealSankhyaGateway.readOrderStageFacts (SELECT only, batched)', () => {
  it('issues exactly the five SELECTs of the stage read and maps header, pending releases, assignee and invoice link', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(ok(HEADER_COLUMNS, [[2506, 1001, 'A', 'S', 0], [2507, 1001, 'L', 'N', 7]]));
    mock.forced.push(ok(RELEASE_COLUMNS, [[2506, 44, 1], [2506, 3, null]]));
    mock.forced.push(ok(ASSIGNEE_COLUMNS, [[2506, 44, 1, 120], [2506, 3, null, null]]));
    mock.forced.push(ok(LINK_COLUMNS, [[2507, 9100], [2507, 9101]]));
    mock.forced.push(ok(NUMBER_COLUMNS, [[9100, null], [9101, 5001]]));
    const readings = await gateway.readOrderStageFacts([2506, 2507, 9999]);
    const sqls = mock.queries().map((query) => query.sql);
    expect(sqls).toEqual([
      'SELECT NUNOTA, CODTIPOPER, STATUSNOTA, PENDENTE, ORDEMCARGA FROM TGFCAB WHERE NUNOTA IN (2506,2507,9999)',
      "SELECT NUCHAVE, EVENTO, SEQCASCATA FROM TSILIB WHERE TABELA = 'TGFCAB' AND DHLIB IS NULL AND NUCHAVE IN (2506,2507,9999)",
      "SELECT NUCHAVE, EVENTO, SEQCASCATA, CODUSULIB FROM TSILIB WHERE TABELA = 'TGFCAB' AND DHLIB IS NULL AND NUCHAVE IN (2506,2507,9999)",
      'SELECT NUNOTAORIG, NUNOTA FROM TGFVAR WHERE NUNOTAORIG IN (2506,2507,9999)',
      'SELECT NUNOTA, NUMNOTA FROM TGFCAB WHERE NUNOTA IN (9100,9101)',
    ]);
    for (const sql of sqls) expect(sql).toMatch(/^SELECT /);
    expect(readings).toEqual([
      {
        erpOrderNumber: 2506,
        found: true,
        codtipoper: 1001,
        statusNota: 'A',
        pending: 'S',
        orderCargo: 0,
        pendingReleases: [
          { event: 44, cascadeSequence: 1, assignedUserCode: 120 },
          { event: 3, cascadeSequence: null, assignedUserCode: null },
        ],
        hasInvoiceLink: false,
        invoiceNumber: null,
      },
      {
        erpOrderNumber: 2507,
        found: true,
        codtipoper: 1001,
        statusNota: 'L',
        pending: 'N',
        orderCargo: 7,
        pendingReleases: [],
        hasInvoiceLink: true,
        // The earliest linked note WITH a number gives the invoice number (9100 has none, 9101 does).
        invoiceNumber: 5001,
      },
      { erpOrderNumber: 9999, found: false, codtipoper: null, statusNota: null, pending: null, orderCargo: null, pendingReleases: [], hasInvoiceLink: false, invoiceNumber: null },
    ]);
  });

  it('reads in batches of 100 note numbers and never queries when there is nothing to read', async () => {
    const empty = setup();
    expect(await empty.gateway.readOrderStageFacts([])).toEqual([]);
    expect(empty.mock.queries()).toHaveLength(0);

    const { gateway, mock } = setup();
    const numbers = Array.from({ length: 250 }, (_, index) => 1000 + index);
    for (let chunk = 0; chunk < 3; chunk += 1) {
      mock.forced.push(ok(HEADER_COLUMNS, []), ok(RELEASE_COLUMNS, []), ok(ASSIGNEE_COLUMNS, []), ok(LINK_COLUMNS, []));
    }
    const readings = await gateway.readOrderStageFacts(numbers);
    expect(readings).toHaveLength(250);
    const lists = mock.queries().map((query) => /IN \(([\d,]+)\)/.exec(query.sql ?? '')?.[1]?.split(',').length ?? 0);
    // Four SELECTs per chunk (header, releases, assignees, links), three chunks of 100/100/50; no link means no sale-note query.
    expect(lists).toEqual([100, 100, 100, 100, 100, 100, 100, 100, 50, 50, 50, 50]);
    for (const query of mock.queries()) expect(query.sql).toMatch(/^SELECT /);
  });

  it('refuses an order number that is not a positive integer before any query', async () => {
    const { gateway, mock } = setup();
    await expect(gateway.readOrderStageFacts([2506, 0])).rejects.toMatchObject({ kind: 'validation' });
    await expect(gateway.readOrderStageFacts([1.5])).rejects.toMatchObject({ kind: 'validation' });
    await expect(gateway.readOrderStageFacts([-3])).rejects.toMatchObject({ kind: 'validation' });
    expect(mock.queries()).toHaveLength(0);
  });

  it.each([
    ['header query', 0],
    ['release query', 1],
    ['link query', 3],
  ])('a failing %s fails the whole call (nothing is guessed from a partial read)', async (_name, failAt) => {
    const { gateway, mock } = setup();
    const answers = [ok(HEADER_COLUMNS, [[2506, 1001, 'A', 'S', 0]]), ok(RELEASE_COLUMNS, []), ok(ASSIGNEE_COLUMNS, []), ok(LINK_COLUMNS, [])];
    for (let index = 0; index < 4; index += 1) mock.forced.push(index === failAt ? httpStatus(503) : answers[index]!);
    await expect(gateway.readOrderStageFacts([2506])).rejects.toBeInstanceOf(SankhyaGatewayError);
  });

  it('a failing CODUSULIB (assignee) query is SOFT: the stage facts stay valid and assigneeReadErrorCode is set', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(ok(HEADER_COLUMNS, [[2506, 1001, 'A', 'S', 0]]));
    mock.forced.push(ok(RELEASE_COLUMNS, [[2506, 44, 1]]));
    mock.forced.push(httpStatus(503));
    mock.forced.push(ok(LINK_COLUMNS, []));
    const [reading] = await gateway.readOrderStageFacts([2506]);
    expect(reading).toMatchObject({ found: true, statusNota: 'A', hasInvoiceLink: false });
    expect(reading?.pendingReleases).toEqual([{ event: 44, cascadeSequence: 1 }]);
    expect(typeof reading?.assigneeReadErrorCode).toBe('string');
    expect(reading?.assigneeReadErrorCode).not.toBe('');
  });

  it('a failing sale-note number query also fails the call', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(ok(HEADER_COLUMNS, [[2506, 1001, 'L', 'N', 0]]));
    mock.forced.push(ok(RELEASE_COLUMNS, []));
    mock.forced.push(ok(ASSIGNEE_COLUMNS, []));
    mock.forced.push(ok(LINK_COLUMNS, [[2506, 9100]]));
    mock.forced.push(httpStatus(503));
    await expect(gateway.readOrderStageFacts([2506])).rejects.toMatchObject({ kind: expect.stringMatching(/unavailable|temporary/) });
  });

  it('a link whose sale note has no readable number still counts as an invoicing link', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(ok(HEADER_COLUMNS, [[2506, 1001, 'L', 'N', 0]]));
    mock.forced.push(ok(RELEASE_COLUMNS, []));
    mock.forced.push(ok(ASSIGNEE_COLUMNS, []));
    mock.forced.push(ok(LINK_COLUMNS, [[2506, 9100]]));
    mock.forced.push(ok(NUMBER_COLUMNS, [[9100, 0]]));
    const [reading] = await gateway.readOrderStageFacts([2506]);
    expect(reading).toMatchObject({ hasInvoiceLink: true, invoiceNumber: null });
  });
});

describe('order-stage-facts fixture contract', () => {
  interface Case {
    name: string;
    tgfcab: Record<string, string | number | null>;
    tsilib: Record<string, number | null>[];
    tgfvar: Record<string, number>[];
    saleNote?: { NUNOTA: number; NUMNOTA: number };
    expectedStage: string;
  }
  const fixture = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'order-stage-facts.json'), 'utf8')) as { provenance: Record<string, string>; cases: Case[] };

  it('declares its provenance as synthetic and not a capture', () => {
    expect(fixture.provenance.environment).toMatch(/synthetic/i);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(6);
  });

  it.each(fixture.cases.map((entry) => [entry.name, entry] as const))('%s: recorded rows -> gateway reading -> domain stage', async (_name, entry) => {
    const { gateway, mock } = setup();
    const nunota = entry.tgfcab.NUNOTA as number;
    mock.forced.push(ok(HEADER_COLUMNS, [HEADER_COLUMNS.map((column) => entry.tgfcab[column] ?? null)]));
    mock.forced.push(ok(RELEASE_COLUMNS, entry.tsilib.map((row) => RELEASE_COLUMNS.map((column) => row[column] ?? null))));
    mock.forced.push(ok(ASSIGNEE_COLUMNS, entry.tsilib.map((row) => ASSIGNEE_COLUMNS.map((column) => row[column] ?? null))));
    mock.forced.push(ok(LINK_COLUMNS, entry.tgfvar.map((row) => LINK_COLUMNS.map((column) => row[column] ?? null))));
    if (entry.saleNote !== undefined) mock.forced.push(ok(NUMBER_COLUMNS, [[entry.saleNote.NUNOTA, entry.saleNote.NUMNOTA]]));
    const [reading] = await gateway.readOrderStageFacts([nunota]);
    expect(reading?.found).toBe(true);
    const stage = classifyOrderStage({
      nunota,
      codtipoper: reading!.codtipoper,
      statusnota: reading!.statusNota,
      pendente: reading!.pending,
      ordemcarga: reading!.orderCargo,
      pendingReleases: reading!.pendingReleases,
      hasInvoiceLink: reading!.hasInvoiceLink,
      invoiceNumber: reading!.invoiceNumber,
      isQuotation: false,
    });
    expect(stage.code).toBe(entry.expectedStage);
    if (entry.saleNote !== undefined) expect(reading?.invoiceNumber).toBe(entry.saleNote.NUMNOTA);
  });
});

describe('FakeGateway.readOrderStageFacts (contract of the fake)', () => {
  it('derives a default reading from the stored order and reports unknown numbers as not found', async () => {
    const book = new FakeOrderBook();
    const gateway = new FakeGateway({ orders: book });
    const [unknown] = await gateway.readOrderStageFacts([123456]);
    expect(unknown).toEqual({ erpOrderNumber: 123456, found: false, codtipoper: null, statusNota: null, pending: null, orderCargo: null, pendingReleases: [], hasInvoiceLink: false, invoiceNumber: null });
  });

  it('returns what a test set (the state machine), one entry per requested number, in order', async () => {
    const book = new FakeOrderBook();
    const gateway = new FakeGateway({ orders: book });
    book.stageFacts.set(10, { found: true, codtipoper: 1001, statusNota: 'A', pending: 'S', orderCargo: null, pendingReleases: [{ event: 44, cascadeSequence: 1 }], hasInvoiceLink: false, invoiceNumber: null });
    book.stageFacts.set(11, { found: true, codtipoper: 1001, statusNota: 'L', pending: 'N', orderCargo: 3, pendingReleases: [], hasInvoiceLink: true, invoiceNumber: 77 });
    const readings = await gateway.readOrderStageFacts([11, 10, 12]);
    expect(readings.map((reading) => [reading.erpOrderNumber, reading.found])).toEqual([[11, true], [10, true], [12, false]]);
    expect(readings[0]).toMatchObject({ orderCargo: 3, invoiceNumber: 77 });
    expect(readings[1]?.pendingReleases).toEqual([{ event: 44, cascadeSequence: 1 }]);
  });
});

describe('owner Sandbox facts of 2026-11-23 (SELECT-only values, replayed through the mocked transport)', () => {
  it('orders 2508-2511 (STATUSNOTA A, PENDENTE S, ORDEMCARGA 0, no TSILIB, no TGFVAR) are "received" and the 2449/2450/2454 chains are "invoiced"', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(
      ok(HEADER_COLUMNS, [[2508, 1001, 'A', 'S', 0], [2509, 1001, 'A', 'S', 0], [2510, 1001, 'A', 'S', 0], [2511, 1001, 'A', 'S', 0], [2449, 1001, 'A', 'N', 0], [2450, 1001, 'A', 'N', 0], [2454, 1001, 'A', 'N', 0]]),
      // 2454 has TSILIB event 2 with DHLIB filled: the SELECT (DHLIB IS NULL) returns no row for it.
      ok(RELEASE_COLUMNS, []),
      ok(ASSIGNEE_COLUMNS, []),
      ok(LINK_COLUMNS, [[2449, 2450], [2450, 2451], [2454, 2455]]),
      ok(NUMBER_COLUMNS, [[2450, null], [2451, null], [2455, null]]),
    );
    const readings = await gateway.readOrderStageFacts([2508, 2509, 2510, 2511, 2449, 2450, 2454]);
    const stageOf = (number: number): string => {
      const reading = readings.find((candidate) => candidate.erpOrderNumber === number);
      if (reading === undefined) throw new Error('missing reading');
      return classifyOrderStage({
        nunota: number,
        codtipoper: reading.codtipoper,
        statusnota: reading.statusNota,
        pendente: reading.pending,
        ordemcarga: reading.orderCargo,
        pendingReleases: reading.pendingReleases,
        hasInvoiceLink: reading.hasInvoiceLink,
        invoiceNumber: reading.invoiceNumber,
        isQuotation: false,
      }).code;
    };
    for (const number of [2508, 2509, 2510, 2511]) expect(stageOf(number)).toBe('received');
    // Each note that is the origin of a TGFVAR link is invoiced: the first and the converted note of the chain.
    for (const number of [2449, 2450, 2454]) expect(stageOf(number)).toBe('invoiced');
    expect(readings.find((reading) => reading.erpOrderNumber === 2454)?.pendingReleases).toEqual([]);
    for (const query of mock.queries()) expect(query.sql).toMatch(/^SELECT /);
  });
});
