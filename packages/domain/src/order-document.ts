import { normalizeDecimalString } from './money.js';

/**
 * Order document (D-J): ONE HTML template with the installation brand, shared by web (print / PDF) and mobile (share PDF).
 * Pure functions, no DOM, no Node built-ins, no clock. The model carries ONLY what the order screen already shows:
 * never cost, margin, the customer's document, seller, price table or approval details (P-20). `toOrderDocument` is the
 * single allow-list that copies fields; the renderer reads only the model's own fields.
 */

const BRAND_BLUE = '#01136A';
const BRAND_RED = '#FF0109';
const DASH = '—';

/** What the callers may hand over: structural, so server order details and local drafts both fit. Extra properties are ignored. */
export interface OrderDocumentSource {
  /** TOP kind (J3): quote or order. Absent = order. */
  readonly kind?: 'order' | 'quote';
  /** Commercial conditions already labelled by the caller (payment condition, negotiation type…); never financial/credit data. */
  readonly conditions?: readonly { readonly label: string; readonly value: string }[];
  readonly draftNumber: number | null;
  /** Sankhya order number once the order exists there. */
  readonly erpNumber: number | null;
  readonly customerCode: number;
  readonly customerName: string;
  /** Human state label chosen by the caller (user text says "Sankhya", never "ERP": D-L). */
  readonly statusLabel: string;
  readonly createdAt: string;
  readonly notes: string | null;
  readonly items: readonly {
    readonly lineNo: number;
    readonly productCode: number;
    readonly productDescription: string;
    readonly unit: string;
    /** Decimal string, up to 4 decimal places. */
    readonly quantity: string;
    /** `null` = "Sem preço". */
    readonly unitListPrice: string | null;
    readonly discountPercent: string;
    readonly estimatedLineTotal: string | null;
    /** Estimated IPI rate in percent when known; absent/null = shown as a dash, never zero. */
    readonly ipiPercent?: string | null;
  }[];
  readonly totals: {
    readonly estimatedTotal: string;
    readonly isPartial: boolean;
    readonly unpricedLineCount: number;
  };
  /** Estimated IPI (D-D); absent = the document shows no IPI lines. */
  readonly ipi?: {
    readonly ipiEstimated: string;
    readonly grandTotalEstimated: string;
    readonly isPartial: boolean;
  };
}

export type OrderDocumentModel = OrderDocumentSource;

export function toOrderDocument(source: OrderDocumentSource): OrderDocumentModel {
  return {
    ...(source.kind === undefined ? {} : { kind: source.kind }),
    ...(source.conditions === undefined
      ? {}
      : { conditions: source.conditions.map((c) => ({ label: c.label, value: c.value })) }),
    draftNumber: source.draftNumber,
    erpNumber: source.erpNumber,
    customerCode: source.customerCode,
    customerName: source.customerName,
    statusLabel: source.statusLabel,
    createdAt: source.createdAt,
    notes: source.notes,
    items: source.items.map((item) => ({
      lineNo: item.lineNo,
      productCode: item.productCode,
      productDescription: item.productDescription,
      unit: item.unit,
      quantity: item.quantity,
      unitListPrice: item.unitListPrice,
      discountPercent: item.discountPercent,
      estimatedLineTotal: item.estimatedLineTotal,
      ...(item.ipiPercent === undefined ? {} : { ipiPercent: item.ipiPercent }),
    })),
    totals: {
      estimatedTotal: source.totals.estimatedTotal,
      isPartial: source.totals.isPartial,
      unpricedLineCount: source.totals.unpricedLineCount,
    },
    ...(source.ipi === undefined
      ? {}
      : {
          ipi: {
            ipiEstimated: source.ipi.ipiEstimated,
            grandTotalEstimated: source.ipi.grandTotalEstimated,
            isPartial: source.ipi.isPartial,
          },
        }),
  };
}

/* ---------- pt-BR formatting on decimal strings (never `number`) ---------- */

function split(value: string): { integer: string; fraction: string } | null {
  let plain: string;
  try {
    plain = normalizeDecimalString(value);
  } catch {
    return null;
  }
  const [integer = '0', fraction = ''] = plain.split('.');
  return { integer: integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.'), fraction };
}

/** `R$ 1.234,50`; unit prices keep their own extra decimals (`R$ 12,3456`). */
export function formatDocumentMoney(value: string): string {
  const parts = split(value);
  return parts === null ? DASH : `R$ ${parts.integer},${parts.fraction.padEnd(2, '0')}`;
}

/** `1.250,5`; no trailing zeros, up to the 4 places the quantity allows. */
export function formatDocumentQuantity(value: string): string {
  const parts = split(value);
  return parts === null ? DASH : parts.fraction === '' ? parts.integer : `${parts.integer},${parts.fraction}`;
}

/** `10,5%`; a zero discount is shown as a dash. */
export function formatDocumentPercent(value: string): string {
  const parts = split(value);
  if (parts === null || (parts.integer === '0' && parts.fraction === '')) return DASH;
  return `${parts.fraction === '' ? parts.integer : `${parts.integer},${parts.fraction}`}%`;
}

const BUSINESS_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

/** `dd/mm/aaaa` in the business time zone (America/Sao_Paulo, UTC-3 with no daylight saving since 2019). */
export function formatDocumentDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return DASH;
  const local = new Date(time - BUSINESS_UTC_OFFSET_MS);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()}`;
}

/** `dd/mm/aaaa hh:mm` in the business time zone. */
export function formatDocumentDateTime(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return DASH;
  const local = new Date(time - BUSINESS_UTC_OFFSET_MS);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${formatDocumentDate(iso)} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

/* ---------- HTML ---------- */

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only an embedded PNG/JPEG or an http(s) URL with plain characters is accepted as logo; anything else falls back to the wordmark. */
function safeLogoSrc(src: string | undefined): string | null {
  if (src === undefined) return null;
  if (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(src)) return src;
  if (/^https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]+$/.test(src)) return src;
  return null;
}

export interface OrderHtmlOptions {
  /** Absolute URL or data URI of the brand logo (data URI on mobile: it works offline). Without it a text wordmark is used. */
  readonly logoSrc?: string;
  /** Brand name shown as the text wordmark and the logo alt text; supplied by the app (installation configuration), never a literal here. */
  readonly brandName?: string;
  /** Document title (browser tab / file name). */
  readonly title?: string;
  /** Moment of issue (the caller's clock; the domain has none). Absent = the footer omits the moment. */
  readonly issuedAt?: string;
  /** Seller shown in the footer. */
  readonly sellerName?: string;
  /** Company data from the installation brand configuration. Only the supplied fields are printed; none is invented. */
  readonly company?: OrderDocumentCompany;
}

export interface OrderDocumentCompany {
  readonly legalName?: string;
  readonly cnpj?: string;
  readonly address?: string;
  readonly phone?: string;
  readonly email?: string;
}

const STYLE = `
@page { size: A4; margin: 15mm; @bottom-right { content: "página " counter(page) " de " counter(pages); font-size: 8pt; color: #555; } }
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #1a1a1a; }
header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid ${BRAND_BLUE}; padding-bottom: 8px; }
header img { height: 44px; }
.wordmark { font-size: 26px; font-weight: 800; color: ${BRAND_BLUE}; letter-spacing: 1px; }
.wordmark span { color: ${BRAND_RED}; }
.company { margin-top: 4px; font-size: 9pt; color: #444; }
.kind { font-size: 9pt; font-weight: 800; letter-spacing: 1px; color: ${BRAND_RED}; text-align: right; }
h1 { margin: 0; font-size: 16pt; color: ${BRAND_BLUE}; text-align: right; }
.meta { text-align: right; color: #444; margin-top: 2px; }
.badge { display: inline-block; margin-top: 4px; padding: 1px 8px; border: 1px solid ${BRAND_RED}; color: ${BRAND_RED}; border-radius: 10px; font-weight: 700; }
section { margin-top: 12px; }
.cols { display: flex; gap: 12px; }
.cols > div { flex: 1; border: 1px solid #ddd; padding: 6px; }
h2 { margin: 0 0 4px; font-size: 10.5pt; color: ${BRAND_BLUE}; text-transform: uppercase; letter-spacing: .5px; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
th { background: ${BRAND_BLUE}; color: #fff; text-align: left; padding: 5px 6px; font-size: 9pt; }
td { padding: 5px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
th.n, td.n { text-align: right; white-space: nowrap; }
tr { page-break-inside: avoid; }
.total { margin-top: 10px; text-align: right; font-size: 13pt; font-weight: 800; color: ${BRAND_BLUE}; }
.hint { color: #555; font-size: 9pt; margin-top: 2px; text-align: right; }
.notes { white-space: pre-wrap; border: 1px solid #ddd; padding: 6px; min-height: 40px; }
footer { margin-top: 16px; border-top: 1px solid ${BRAND_RED}; padding-top: 6px; color: #555; font-size: 8pt; }
`;

function companyBlock(company: OrderDocumentCompany | undefined): string {
  if (company === undefined) return '';
  const lines = [
    company.legalName,
    company.cnpj === undefined ? undefined : `CNPJ ${company.cnpj}`,
    company.address,
    company.phone === undefined ? undefined : `Tel. ${company.phone}`,
    company.email,
  ].filter((line): line is string => line !== undefined && line.trim() !== '');
  return lines.length === 0 ? '' : `<div class="company">${lines.map((line) => escapeHtml(line)).join('<br>')}</div>`;
}

export function renderOrderHtml(model: OrderDocumentModel, options: OrderHtmlOptions = {}): string {
  const logo = safeLogoSrc(options.logoSrc);
  const brandName = escapeHtml(options.brandName ?? '');
  const brand = logo === null ? `<div class="wordmark">${brandName}<span>.</span></div>` : `<img src="${escapeHtml(logo)}" alt="${brandName}">`;
  const isQuote = model.kind === 'quote';
  const noun = isQuote ? 'Orçamento' : 'Pedido';
  const forceNumber =
    model.draftNumber === null
      ? `${noun}${isQuote ? '' : ' Force'} (sem número ainda)`
      : `${noun}${isQuote ? '' : ' Force'} nº ${escapeHtml(model.draftNumber)}`;
  const erpLine = model.erpNumber === null ? '' : `<div class="meta">${noun} Sankhya nº ${escapeHtml(model.erpNumber)}</div>`;
  const title = options.title ?? (model.draftNumber === null ? noun : `${noun} ${model.draftNumber}`);

  const rows = model.items
    .map((item) => {
      const price = item.unitListPrice === null ? 'Sem preço' : formatDocumentMoney(item.unitListPrice);
      const total = item.estimatedLineTotal === null ? 'Sem preço' : formatDocumentMoney(item.estimatedLineTotal);
      const ipi = item.ipiPercent === undefined || item.ipiPercent === null ? DASH : formatDocumentPercent(item.ipiPercent);
      return `<tr><td>${escapeHtml(item.lineNo)}</td><td>${escapeHtml(item.productCode)}</td><td>${escapeHtml(item.productDescription)}</td><td>${escapeHtml(item.unit)}</td><td class="n">${escapeHtml(formatDocumentQuantity(item.quantity))}</td><td class="n">${escapeHtml(price)}</td><td class="n">${escapeHtml(formatDocumentPercent(item.discountPercent))}</td><td class="n">${escapeHtml(ipi)}</td><td class="n">${escapeHtml(total)}</td></tr>`;
    })
    .join('');

  const partial = model.totals.isPartial
    ? `<div class="hint">Valor parcial: ${escapeHtml(model.totals.unpricedLineCount)} item(ns) sem preço.</div>`
    : '';
  const ipiBlock =
    model.ipi === undefined
      ? ''
      : `<div class="total">IPI estimado: ${escapeHtml(formatDocumentMoney(model.ipi.ipiEstimated))}</div><div class="total">${model.ipi.isPartial ? 'Total parcial estimado (com IPI)' : 'Total estimado (com IPI)'}: ${escapeHtml(formatDocumentMoney(model.ipi.grandTotalEstimated))}</div><div class="hint">IPI estimado a partir das alíquotas disponíveis${model.ipi.isPartial ? ' (apenas nos itens com alíquota)' : ''}; o valor final é calculado no Sankhya.</div>`;
  const conditions = (model.conditions ?? [])
    .map((c) => `<div>${escapeHtml(c.label)}: <strong>${escapeHtml(c.value)}</strong></div>`)
    .join('');
  const issued =
    options.issuedAt === undefined
      ? 'Emitido pelo Sales Force'
      : `Emitido pelo Sales Force em ${escapeHtml(formatDocumentDateTime(options.issuedAt))}`;
  const seller = options.sellerName === undefined || options.sellerName.trim() === '' ? '' : ` · ${escapeHtml(options.sellerName)}`;

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body>
<header>
<div>${brand}${companyBlock(options.company)}</div>
<div><div class="kind">${isQuote ? 'ORÇAMENTO' : 'PEDIDO'}</div><h1>${forceNumber}</h1>${erpLine}<div class="meta">Data ${escapeHtml(formatDocumentDate(model.createdAt))}</div><div class="badge">${escapeHtml(model.statusLabel)}</div></div>
</header>
<section class="cols">
<div><h2>Cliente</h2><div><strong>${escapeHtml(model.customerName)}</strong></div><div>Cliente ${escapeHtml(model.customerCode)}</div></div>
<div><h2>Condições</h2>${conditions === '' ? DASH : conditions}</div>
</section>
<section><h2>Itens</h2>
<table><thead><tr><th>Item</th><th>Código</th><th>Descrição</th><th>Un.</th><th class="n">Quantidade</th><th class="n">Preço unit.</th><th class="n">Desconto</th><th class="n">IPI %</th><th class="n">Total</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="total">Total estimado: ${escapeHtml(formatDocumentMoney(model.totals.estimatedTotal))}</div>${partial}${ipiBlock}
</section>
<section><h2>Observações</h2><div class="notes">${model.notes === null ? '' : escapeHtml(model.notes)}</div></section>
<footer>${issued}${seller}</footer>
</body></html>`;
}
