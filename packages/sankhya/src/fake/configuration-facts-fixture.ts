import type {
  CompanyRow,
  ConfigQuerySource,
  ConfigurationFacts,
  EnabledTopRow,
  NegotiationTypeRow,
  OrderStatusRow,
  TopGroupRow,
} from '../configuration-facts.js';
import { CONFIG_QUERIES } from '../real/configuration-queries.js';

/**
 * Code fixture for the fake gateway: the PLAC configuration values recorded in spike §9.49 item 3
 * (TOPs, company/default TOP, parameter values, counts). Only codes, descriptions of TOPs / negotiation
 * types / statuses and flags; descriptions, colours and group assignment are SYNTHETIC placeholders
 * (the real texts are not recorded). No person names, no credentials.
 */

export const PLAC_FIXTURE_READ_AT = '2026-10-30T12:00:00.000Z';

const TOP_CODES = [1000, 1001, 1009, 1051, 1061, 2209, 2309] as const;
const QUOTE_TOP_CODE = 1051;

const src = (key: keyof typeof CONFIG_QUERIES): ConfigQuerySource => CONFIG_QUERIES[key].source;

const companies: CompanyRow[] = [
  { companyCode: 1, tradeName: 'Empresa sintetica 1', mobile: true, defaultOrderTopCode: 1001 },
  { companyCode: 2, tradeName: 'Empresa sintetica 2', mobile: false, defaultOrderTopCode: null },
];

const tops: EnabledTopRow[] = TOP_CODES.map((topCode) => ({
  topCode,
  description: `TOP sintetica ${topCode}`,
  movementType: 'P',
  mobile: true,
  skipConfirmation: topCode === 1000,
  allowInvoiceInApp: false,
  changedAt: '2026-01-01 00:00:00',
}));

const groups: TopGroupRow[] = [
  { groupId: 1, groupName: 'PEDIDO', order: 1, topCode: 1000 },
  { groupId: 1, groupName: 'PEDIDO', order: 1, topCode: 1001 },
  ...TOP_CODES.filter((c) => c !== 1000 && c !== 1001 && c !== QUOTE_TOP_CODE).map(
    (topCode): TopGroupRow => ({ groupId: 1, groupName: 'PEDIDO', order: 1, topCode }),
  ),
  { groupId: 2, groupName: 'ORÇAMENTO', order: 2, topCode: QUOTE_TOP_CODE },
];

/** 35 enabled negotiation types, codes 1..35, including 23 and 24 (returns). */
const negotiationTypes: NegotiationTypeRow[] = Array.from({ length: 35 }, (_, i): NegotiationTypeRow => {
  const code = i + 1;
  return {
    code,
    description: code === 23 || code === 24 ? `Devolucao sintetica ${code}` : `Condicao sintetica ${code}`,
    active: true,
    mobile: true,
    sale: code !== 23 && code !== 24,
    changedAt: '2026-01-01 00:00:00',
  };
});

const statuses: OrderStatusRow[] = Array.from({ length: 8 }, (_, i): OrderStatusRow => {
  const code = i + 1;
  return {
    code,
    name: `Status sintetico ${code}`,
    description: `Descricao sintetica do status ${code}`,
    color: ['9E9E9E', '2196F3', 'FFC107', '4CAF50', 'F44336', '9C27B0', '795548', '607D8B'][i] ?? '000000',
    canEdit: code <= 2,
    canDuplicate: true,
    canDelete: code === 1,
  };
});

export const PLAC_CONFIGURATION_FACTS: ConfigurationFacts = {
  readAt: PLAC_FIXTURE_READ_AT,
  q1GeneralParameters: {
    ok: true,
    source: src('Q1'),
    rows: [
      {
        nucfg: 1,
        orderStockLocationCode: 209,
        catalogReferenceTableCode: 5,
        alternativeTableCode: 5,
        decimalQuantities: true,
        historyDays: 90,
        purchasedWindowDays: 90,
        usesFinancial: true,
        hidesCreditLimit: null,
        informational: {
          TIPDESC: null, VALDESCMAX: null, VALVLRMIN: null, DECVLR: null, ALTTIPNEG: null, PERMALTPRECOPROD: null,
          PERMITEDESCNOAPP: null, APLICDESCMSS: null, APLICADESCTOT: null, HABIIMPPLAN: null, PERMITEIMPRIMIR: null,
          TEMPODADOSOFFLINE: null, BLOQVENDPPRAZO: null, BLOQVENDCLIINAD: null, BLOQVENDCLIBLOQ: null,
          DIASPARAATRASO: null, EXIBLIMCRECAR: null, VERSAOMINIMA: null, DHALT: null,
        },
      },
    ],
  },
  q2Companies: { ok: true, source: src('Q2'), rows: companies },
  q3EnabledTops: { ok: true, source: src('Q3'), rows: tops },
  q4TopGroups: { ok: true, source: src('Q4'), rows: groups },
  q5NegotiationTypes: { ok: true, source: src('Q5'), rows: negotiationTypes },
  q6PriceTables: {
    ok: true,
    source: src('Q6'),
    rows: [
      { tableCode: 5, mobile: true },
      { tableCode: 6, mobile: false },
    ],
  },
  q7OrderStatuses: { ok: true, source: src('Q7'), rows: statuses },
  q8ProductMobility: {
    ok: true,
    source: src('Q8'),
    rows: [
      { mobile: true, count: 120 },
      { mobile: false, count: 80 },
      { mobile: null, count: 5 },
    ],
  },
};
