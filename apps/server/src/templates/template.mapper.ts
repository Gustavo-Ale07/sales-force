import type { OrderTemplate, OrderTemplateDetail } from '@salesforce/contracts';
import { normalizeDecimalString } from '@salesforce/domain';
import type { TemplateItemRow, TemplateRow } from './templates.repository.js';

export function toTemplate(row: TemplateRow, itemCount: number): OrderTemplate {
  return {
    id: row.id,
    customerCode: row.customerCode,
    name: row.name,
    version: row.version,
    itemCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Template + its lines (product and quantity only: a template stores no price). */
export function toTemplateDetail(row: TemplateRow, items: readonly TemplateItemRow[]): OrderTemplateDetail {
  return {
    ...toTemplate(row, items.length),
    items: items.map((item) => ({ productCode: item.productCode, quantity: normalizeDecimalString(item.quantity) })),
  };
}
