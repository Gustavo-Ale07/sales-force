import { IMPORT_MAX_FILE_BYTES, IMPORT_MAX_ROWS } from '@salesforce/contracts';
import { inflateRawSync } from 'node:zlib';
import readXlsxFile from 'read-excel-file/node';

/**
 * Safe reading of an uploaded spreadsheet (RF-IMP-1). Type, size, signature and row count are checked BEFORE or while
 * parsing, never after. Formulas are never evaluated: the library returns the cached cell value, and an `.xlsx` is a zip
 * of XML parts, so a macro (`.xlsm`/`vbaProject.bin`) is never run and is refused by extension. A zip whose entries
 * would inflate beyond a sane size is refused before it is opened (zip bomb).
 */

export type ImportFailureCode =
  | 'import_file_type_not_allowed'
  | 'import_file_too_large'
  | 'import_file_unreadable'
  | 'import_too_many_rows'
  | 'import_empty';

export const importFailureMessages: Record<ImportFailureCode, string> = {
  import_file_type_not_allowed: 'Formato não suportado. Envie um arquivo .xlsx ou .csv.',
  import_file_too_large: 'O arquivo é grande demais (limite de 20 MB).',
  import_file_unreadable: 'Não foi possível ler o arquivo. Confira se ele não está protegido por senha nem corrompido.',
  import_too_many_rows: 'O arquivo tem linhas demais (limite de 50 mil).',
  import_empty: 'O arquivo não tem linhas para importar.',
};

export class ImportFileError extends Error {
  constructor(readonly code: ImportFailureCode) {
    super(code);
  }
}

export type SpreadsheetKind = 'xlsx' | 'csv';

/** One data row: its line number in the file (1-based, header included) and the cell texts. */
export interface SpreadsheetRow {
  readonly line: number;
  readonly cells: readonly string[];
}

export interface Spreadsheet {
  readonly headers: readonly string[];
  readonly rows: readonly SpreadsheetRow[];
}

const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2_000;

export function spreadsheetKindOf(fileName: string): SpreadsheetKind | null {
  const name = fileName.trim().toLowerCase();
  if (name.endsWith('.xlsx')) return 'xlsx';
  if (name.endsWith('.csv')) return 'csv';
  return null;
}

/** Decoded size of a base64 text, from its length alone (nothing is decoded yet). */
export function base64DecodedSize(text: string): number {
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return Math.floor((text.length * 3) / 4) - padding;
}

/** Checks type and size from the name and the base64 text, then decodes. Throws {@link ImportFileError}. */
export function decodeImportFile(fileName: string, contentBase64: string): { kind: SpreadsheetKind; bytes: Buffer } {
  const kind = spreadsheetKindOf(fileName);
  if (kind === null) throw new ImportFileError('import_file_type_not_allowed');
  if (base64DecodedSize(contentBase64) > IMPORT_MAX_FILE_BYTES) throw new ImportFileError('import_file_too_large');
  if (!/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(contentBase64)) throw new ImportFileError('import_file_unreadable');
  const bytes = Buffer.from(contentBase64, 'base64');
  if (bytes.length === 0) throw new ImportFileError('import_empty');
  if (bytes.length > IMPORT_MAX_FILE_BYTES) throw new ImportFileError('import_file_too_large');
  assertSignature(kind, bytes);
  return { kind, bytes };
}

function assertSignature(kind: SpreadsheetKind, bytes: Buffer): void {
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (kind === 'xlsx') {
    if (!isZip) throw new ImportFileError('import_file_type_not_allowed');
    assertZipSane(bytes);
    return;
  }
  // A "csv" that is really a zip or a binary is refused.
  if (isZip || bytes.subarray(0, 8192).includes(0)) throw new ImportFileError('import_file_type_not_allowed');
}

/** Reads the zip central directory (no inflate) and refuses an archive that would expand beyond the limit. */
function assertZipSane(bytes: Buffer): void {
  const minEnd = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minEnd; i -= 1) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ImportFileError('import_file_unreadable');
  const entries = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  if (entries > MAX_ZIP_ENTRIES) throw new ImportFileError('import_file_unreadable');
  let total = 0;
  for (let n = 0; n < entries; n += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw new ImportFileError('import_file_unreadable');
    const declared = bytes.readUInt32LE(offset + 24);
    total += declared;
    if (total > MAX_UNCOMPRESSED_BYTES) throw new ImportFileError('import_file_unreadable');
    assertEntryInflatesToDeclared(bytes, offset, declared);
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
}

/**
 * The declared size in the central directory is attacker-controlled, so it is never trusted: each entry is really inflated
 * with a hard output ceiling equal to the declared size and must produce exactly that many bytes (output is discarded).
 */
function assertEntryInflatesToDeclared(bytes: Buffer, central: number, declared: number): void {
  const method = bytes.readUInt16LE(central + 10);
  const compressed = bytes.readUInt32LE(central + 20);
  const local = bytes.readUInt32LE(central + 42);
  if (compressed === 0xffffffff || declared === 0xffffffff || local === 0xffffffff) throw new ImportFileError('import_file_unreadable');
  if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw new ImportFileError('import_file_unreadable');
  const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
  if (start + compressed > bytes.length) throw new ImportFileError('import_file_unreadable');
  const data = bytes.subarray(start, start + compressed);
  if (method === 0) {
    if (compressed !== declared) throw new ImportFileError('import_file_unreadable');
    return;
  }
  if (method !== 8) throw new ImportFileError('import_file_unreadable');
  try {
    const inflated = inflateRawSync(data, { maxOutputLength: Math.max(1, declared) });
    if (inflated.length !== declared) throw new ImportFileError('import_file_unreadable');
  } catch {
    throw new ImportFileError('import_file_unreadable');
  }
}

/** A cell as the text a person would have typed. */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  return String(value).replace(/\u00a0/g, ' ').trim();
}

/** Parses an already validated file. Throws {@link ImportFileError}. */
export async function parseSpreadsheet(kind: SpreadsheetKind, bytes: Buffer): Promise<Spreadsheet> {
  const table = kind === 'csv' ? parseCsvText(decodeCsvBytes(bytes)) : await readXlsxTable(bytes);
  return shapeTable(table);
}

async function readXlsxTable(bytes: Buffer): Promise<unknown[][]> {
  try {
    const sheets = (await readXlsxFile(bytes)) as readonly { readonly data: readonly (readonly unknown[])[] }[];
    const first = sheets[0];
    if (first === undefined) throw new ImportFileError('import_empty');
    if (first.data.length > IMPORT_MAX_ROWS + 1) throw new ImportFileError('import_too_many_rows');
    return first.data.map((row) => [...row]);
  } catch (error) {
    if (error instanceof ImportFileError) throw error;
    throw new ImportFileError('import_file_unreadable');
  }
}

/** UTF-8 (BOM allowed); a file that is not valid UTF-8 is read as Windows-1252, what Excel in pt-BR saves. */
export function decodeCsvBytes(bytes: Buffer): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const text = utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
  return text.replace(/^\ufeff/, '');
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  let best = ';';
  let bestCount = -1;
  for (const candidate of [';', ',', '\t']) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180 reader: quoted cells may hold the delimiter, quotes (`""`) and line breaks. Stops early past the row limit. */
export function parseCsvText(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endRow = (): void => {
    row.push(cell);
    cell = '';
    rows.push(row);
    row = [];
    if (rows.length > IMPORT_MAX_ROWS + 1) throw new ImportFileError('import_too_many_rows');
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
    } else cell += char;
  }
  if (quoted) throw new ImportFileError('import_file_unreadable');
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

function shapeTable(table: readonly (readonly unknown[])[]): Spreadsheet {
  const lines = table.map((cells, index) => ({ line: index + 1, cells: cells.map(cellToText) }));
  const nonBlank = lines.filter((entry) => entry.cells.some((cell) => cell !== ''));
  const [header, ...body] = nonBlank;
  if (header === undefined) throw new ImportFileError('import_empty');
  if (body.length === 0) throw new ImportFileError('import_empty');
  if (body.length > IMPORT_MAX_ROWS) throw new ImportFileError('import_too_many_rows');
  return { headers: header.cells, rows: body };
}
