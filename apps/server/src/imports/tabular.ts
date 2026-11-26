import writeXlsxFile from 'write-excel-file/node';
import type { ExportFormat } from '@salesforce/contracts';

/** Writers for the downloadable tables (exports and the import template). Only text and numbers: no formulas are ever written. */

export type Cell = string | number | boolean | null;

export interface Table {
  readonly sheet: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly Cell[])[];
  /** Column widths in characters (xlsx only). */
  readonly widths?: readonly number[];
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** A text that a spreadsheet program would read as a formula is prefixed with an apostrophe (CSV/formula injection). */
export function neutralizeFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

function textOf(cell: Cell): string {
  if (cell === null) return '';
  if (typeof cell === 'number') return String(cell);
  if (typeof cell === 'boolean') return cell ? 'Sim' : 'Não';
  return neutralizeFormula(cell);
}

function csvField(text: string): string {
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** pt-BR CSV: `;` delimiter, CRLF, UTF-8 with BOM so Excel opens the accents correctly. */
export function toCsv(table: Table): Buffer {
  const lines = [table.headers.map((header) => csvField(neutralizeFormula(header))).join(';')];
  for (const row of table.rows) lines.push(row.map((cell) => csvField(textOf(cell))).join(';'));
  return Buffer.from(`\ufeff${lines.join('\r\n')}\r\n`, 'utf8');
}

export async function toXlsx(table: Table): Promise<Buffer> {
  const header = table.headers.map((value) => ({ value, fontWeight: 'bold' as const }));
  const body = table.rows.map((row) =>
    row.map((cell) => {
      if (cell === null) return null;
      if (typeof cell === 'number') return { value: cell, type: Number };
      if (typeof cell === 'boolean') return { value: cell ? 'Sim' : 'Não', type: String };
      return { value: neutralizeFormula(cell), type: String };
    }),
  );
  const columns = table.widths?.map((width) => ({ width }));
  const result = writeXlsxFile([header, ...body] as never, { sheet: table.sheet, ...(columns === undefined ? {} : { columns }) } as never);
  const buffer = await (result as unknown as { toBuffer(): Promise<Buffer | Uint8Array> }).toBuffer();
  return Buffer.from(buffer);
}

export async function render(table: Table, format: ExportFormat): Promise<Buffer> {
  return format === 'csv' ? toCsv(table) : toXlsx(table);
}
