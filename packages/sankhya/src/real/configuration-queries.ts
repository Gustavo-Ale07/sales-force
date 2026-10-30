import type {
  CompanyRow,
  ConfigQueryId,
  ConfigQuerySource,
  EnabledTopRow,
  GeneralParametersRow,
  NegotiationTypeRow,
  OrderStatusRow,
  PriceTableFlagRow,
  ProductMobilityRow,
  TopGroupRow,
  ConfigScalar,
} from '../configuration-facts.js';
import type { RowReader } from './mapping.js';

/**
 * The eight Vidya-configuration reads (CFG-8; spike §9.49; Part 2 prompt D2). The SQL text is fixed:
 * nothing external reaches it. NEVER `SELECT *` on `AD_TVDYCFGFRC` and never name its credential
 * columns (BASICAUTH, CLIENTSECRET*, KEY*, CERT*): `test/configuration-queries.test.ts` fails if any
 * query cites such a column.
 */

export interface ConfigQueryDef<T> {
  readonly id: ConfigQueryId;
  readonly sql: string;
  /** Result column names (aliases) exactly as the gateway must return them. */
  readonly columns: readonly string[];
  readonly source: ConfigQuerySource;
  /** Q1 only: exactly one row is required. */
  readonly exactlyOneRow?: boolean;
  readonly map: (row: RowReader) => T;
}

const Q1_COLUMNS = [
  'NUCFG', 'CODLOCALPEDIDOS', 'TABPADCSLTPROD', 'CODTABALT', 'TIPDESC', 'VALDESCMAX', 'VALVLRMIN', 'USADECQTD',
  'DECVLR', 'DIASCONSULTAVENDAS', 'QTDDIASPRODCOMPRADOS', 'UTILFINANC', 'ALTTIPNEG', 'PERMALTPRECOPROD',
  'PERMITEDESCNOAPP', 'APLICDESCMSS', 'APLICADESCTOT', 'HABIIMPPLAN', 'PERMITEIMPRIMIR', 'TEMPODADOSOFFLINE',
  'BLOQVENDPPRAZO', 'BLOQVENDCLIINAD', 'BLOQVENDCLIBLOQ', 'DIASPARAATRASO', 'EXIBLIMCRECAR', 'OCLTLIMCRED',
  'VERSAOMINIMA', 'DHALT',
] as const;

const Q1_TYPED = new Set<string>([
  'NUCFG', 'CODLOCALPEDIDOS', 'TABPADCSLTPROD', 'CODTABALT', 'USADECQTD', 'DIASCONSULTAVENDAS',
  'QTDDIASPRODCOMPRADOS', 'UTILFINANC', 'OCLTLIMCRED',
]);

const Q1: ConfigQueryDef<GeneralParametersRow> = {
  id: 'Q1',
  sql: `SELECT ${Q1_COLUMNS.join(', ')} FROM AD_TVDYCFGFRC WHERE NUCFG = 1`,
  columns: Q1_COLUMNS,
  source: { tables: ['AD_TVDYCFGFRC'], columns: Q1_COLUMNS, filter: 'NUCFG = 1' },
  exactlyOneRow: true,
  map: (row) => {
    const informational: Record<string, ConfigScalar> = {};
    for (const column of Q1_COLUMNS) if (!Q1_TYPED.has(column)) informational[column] = row.rawScalar(column);
    return {
      nucfg: row.int('NUCFG'),
      orderStockLocationCode: row.nullableInt('CODLOCALPEDIDOS'),
      catalogReferenceTableCode: row.nullableInt('TABPADCSLTPROD'),
      alternativeTableCode: row.nullableInt('CODTABALT'),
      decimalQuantities: row.nullableFlag('USADECQTD'),
      historyDays: row.nullableInt('DIASCONSULTAVENDAS'),
      purchasedWindowDays: row.nullableInt('QTDDIASPRODCOMPRADOS'),
      usesFinancial: row.nullableFlag('UTILFINANC'),
      hidesCreditLimit: row.nullableFlag('OCLTLIMCRED'),
      informational,
    };
  },
};

const Q2: ConfigQueryDef<CompanyRow> = {
  id: 'Q2',
  sql: 'SELECT CODEMP, NOMEFANTASIA, AD_MOBILIDADE, AD_CODTIPOPERPAD FROM TSIEMP ORDER BY CODEMP',
  columns: ['CODEMP', 'NOMEFANTASIA', 'AD_MOBILIDADE', 'AD_CODTIPOPERPAD'],
  source: { tables: ['TSIEMP'], columns: ['CODEMP', 'NOMEFANTASIA', 'AD_MOBILIDADE', 'AD_CODTIPOPERPAD'] },
  map: (row) => ({
    companyCode: row.int('CODEMP'),
    tradeName: row.nullableText('NOMEFANTASIA'),
    mobile: row.nullableFlag('AD_MOBILIDADE'),
    defaultOrderTopCode: row.nullableInt('AD_CODTIPOPERPAD'),
  }),
};

const Q3_COLUMNS = ['CODTIPOPER', 'DESCROPER', 'TIPMOV', 'AD_MOBILIDADE', 'AD_PULARCONFIRMACAO', 'AD_PERMITEFATURARAPP', 'DHALTER'];
const Q3: ConfigQueryDef<EnabledTopRow> = {
  id: 'Q3',
  sql:
    "SELECT T.CODTIPOPER, T.DESCROPER, T.TIPMOV, T.AD_MOBILIDADE, T.AD_PULARCONFIRMACAO, T.AD_PERMITEFATURARAPP, TO_CHAR(T.DHALTER, 'YYYY-MM-DD HH24:MI:SS') DHALTER FROM TGFTOP T WHERE T.DHALTER = (SELECT MAX(T2.DHALTER) FROM TGFTOP T2 WHERE T2.CODTIPOPER = T.CODTIPOPER) AND T.AD_MOBILIDADE = 'S' ORDER BY T.CODTIPOPER",
  columns: Q3_COLUMNS,
  source: { tables: ['TGFTOP'], columns: Q3_COLUMNS, filter: "current version (MAX(DHALTER)) AND AD_MOBILIDADE = 'S'" },
  map: (row) => ({
    topCode: row.int('CODTIPOPER'),
    description: row.nullableText('DESCROPER'),
    movementType: row.nullableText('TIPMOV'),
    mobile: row.nullableFlag('AD_MOBILIDADE'),
    skipConfirmation: row.nullableFlag('AD_PULARCONFIRMACAO'),
    allowInvoiceInApp: row.nullableFlag('AD_PERMITEFATURARAPP'),
    changedAt: row.nullableText('DHALTER'),
  }),
};

const Q4_COLUMNS = ['NUGRUOP', 'NOME', 'ORDEM', 'CODTIPOPER'];
const Q4: ConfigQueryDef<TopGroupRow> = {
  id: 'Q4',
  sql:
    'SELECT G.NUGRUOP, G.NOME, G.ORDEM, TG.CODTIPOPER FROM AD_TVDYGRUOP G INNER JOIN AD_TVDYTOPGRU TG ON TG.NUCFG = G.NUCFG AND TG.NUGRUOP = G.NUGRUOP WHERE G.NUCFG = 1 ORDER BY G.ORDEM, G.NUGRUOP, TG.CODTIPOPER',
  columns: Q4_COLUMNS,
  source: { tables: ['AD_TVDYGRUOP', 'AD_TVDYTOPGRU'], columns: Q4_COLUMNS, filter: 'NUCFG = 1' },
  map: (row) => ({
    groupId: row.int('NUGRUOP'),
    groupName: row.text('NOME'),
    order: row.nullableInt('ORDEM'),
    topCode: row.int('CODTIPOPER'),
  }),
};

const Q5_COLUMNS = ['CODTIPVENDA', 'DESCRTIPVENDA', 'ATIVO', 'AD_MOBILIDADE', 'AD_VENDA', 'DHALTER'];
const Q5: ConfigQueryDef<NegotiationTypeRow> = {
  id: 'Q5',
  sql:
    "SELECT P.CODTIPVENDA, P.DESCRTIPVENDA, P.ATIVO, P.AD_MOBILIDADE, P.AD_VENDA, TO_CHAR(P.DHALTER, 'YYYY-MM-DD HH24:MI:SS') DHALTER FROM TGFTPV P WHERE P.DHALTER = (SELECT MAX(P2.DHALTER) FROM TGFTPV P2 WHERE P2.CODTIPVENDA = P.CODTIPVENDA) AND P.AD_MOBILIDADE = 'S' ORDER BY P.CODTIPVENDA",
  columns: Q5_COLUMNS,
  source: { tables: ['TGFTPV'], columns: Q5_COLUMNS, filter: "current version (MAX(DHALTER)) AND AD_MOBILIDADE = 'S'" },
  map: (row) => ({
    code: row.int('CODTIPVENDA'),
    description: row.nullableText('DESCRTIPVENDA'),
    active: row.nullableFlag('ATIVO'),
    mobile: row.nullableFlag('AD_MOBILIDADE'),
    sale: row.nullableFlag('AD_VENDA'),
    changedAt: row.nullableText('DHALTER'),
  }),
};

const Q6: ConfigQueryDef<PriceTableFlagRow> = {
  id: 'Q6',
  sql: 'SELECT N.CODTAB, N.AD_MOBILIDADE FROM TGFNTA N ORDER BY N.CODTAB',
  columns: ['CODTAB', 'AD_MOBILIDADE'],
  source: { tables: ['TGFNTA'], columns: ['CODTAB', 'AD_MOBILIDADE'] },
  map: (row) => ({ tableCode: row.int('CODTAB'), mobile: row.nullableFlag('AD_MOBILIDADE') }),
};

const Q7_COLUMNS = ['CODSTATUS', 'NOME', 'DESCRICAO', 'COR', 'PERMEDIT', 'PERMDUPLIC', 'PERMEXC'];
const Q7: ConfigQueryDef<OrderStatusRow> = {
  id: 'Q7',
  sql: 'SELECT CODSTATUS, NOME, DESCRICAO, COR, PERMEDIT, PERMDUPLIC, PERMEXC FROM AD_TVDYFRCSTS WHERE NUCFG = 1 ORDER BY CODSTATUS',
  columns: Q7_COLUMNS,
  source: { tables: ['AD_TVDYFRCSTS'], columns: Q7_COLUMNS, filter: 'NUCFG = 1' },
  map: (row) => ({
    code: row.int('CODSTATUS'),
    name: row.nullableText('NOME'),
    description: row.nullableText('DESCRICAO'),
    color: row.nullableText('COR'),
    canEdit: row.nullableFlag('PERMEDIT'),
    canDuplicate: row.nullableFlag('PERMDUPLIC'),
    canDelete: row.nullableFlag('PERMEXC'),
  }),
};

const Q8: ConfigQueryDef<ProductMobilityRow> = {
  id: 'Q8',
  sql: 'SELECT AD_MOBILIDADE, COUNT(*) QTD FROM TGFPRO GROUP BY AD_MOBILIDADE',
  columns: ['AD_MOBILIDADE', 'QTD'],
  source: { tables: ['TGFPRO'], columns: ['AD_MOBILIDADE'] },
  map: (row) => ({ mobile: row.nullableFlag('AD_MOBILIDADE'), count: row.int('QTD') }),
};

export const CONFIG_QUERIES = { Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8 } as const;

/** Every query text, in Q1..Q8 order (used by the credential-column guard test). */
export const CONFIG_QUERY_TEXTS: readonly string[] = [Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8].map((q) => q.sql);
