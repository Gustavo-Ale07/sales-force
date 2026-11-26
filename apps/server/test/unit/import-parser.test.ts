import { makeZip } from '../helpers/zip.js';
import { describe, expect, it } from 'vitest';
import { IMPORT_MAX_FILE_BYTES } from '@salesforce/contracts';
import { ImportFileError, decodeImportFile, parseSpreadsheet } from '../../src/imports/spreadsheet.js';
import { effectiveMapping, missingRequired, suggestMapping } from '../../src/imports/import-fields.js';
import { customerRowRequestId, readQuantity } from '../../src/imports/import-rows.js';
import { neutralizeFormula, toCsv, toXlsx } from '../../src/imports/tabular.js';

const b64 = (text: string | Buffer): string => Buffer.from(text).toString('base64');

async function parseCsv(text: string) {
  const { kind, bytes } = decodeImportFile('arquivo.csv', b64(text));
  return parseSpreadsheet(kind, bytes);
}

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof ImportFileError) return error.code;
    throw error;
  }
  return 'none';
}

describe('import file: type and size are checked before parsing', () => {
  it('refuses an unknown extension', () => {
    expect(codeOf(() => decodeImportFile('arquivo.exe', b64('a;b')))).toBe('import_file_type_not_allowed');
    expect(codeOf(() => decodeImportFile('arquivo.xls', b64('a;b')))).toBe('import_file_type_not_allowed');
  });

  it('refuses a file over 20 MB from the base64 length, without decoding it', () => {
    const huge = 'A'.repeat(Math.ceil((IMPORT_MAX_FILE_BYTES * 4) / 3) + 100);
    expect(codeOf(() => decodeImportFile('grande.csv', huge))).toBe('import_file_too_large');
  });

  it('refuses an xlsx that is not a zip, and a csv that is a zip or binary', () => {
    expect(codeOf(() => decodeImportFile('falso.xlsx', b64('texto puro')))).toBe('import_file_type_not_allowed');
    const zip = makeZip({ 'a.txt': Buffer.from('x') });
    expect(codeOf(() => decodeImportFile('zip.csv', b64(zip)))).toBe('import_file_type_not_allowed');
    expect(codeOf(() => decodeImportFile('bin.csv', b64(Buffer.from([0x61, 0x00, 0x62]))))).toBe('import_file_type_not_allowed');
  });

  it('refuses an archive that would expand beyond the limit (zip bomb)', () => {
    const bomb = makeZip({ 'xl/big.xml': Buffer.alloc(210 * 1024 * 1024) });
    expect(bomb.length).toBeLessThan(IMPORT_MAX_FILE_BYTES);
    expect(codeOf(() => decodeImportFile('bomba.xlsx', b64(bomb)))).toBe('import_file_unreadable');
  });

  it('refuses an archive whose declared size is smaller than what it really inflates to', () => {
    const honest = makeZip({ 'xl/big.xml': Buffer.alloc(5 * 1024 * 1024) });
    expect(codeOf(() => decodeImportFile('ok.xlsx', b64(honest)))).toBe('none');
    const lying = Buffer.from(honest);
    lying.writeUInt32LE(10, lying.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
    expect(codeOf(() => decodeImportFile('mente.xlsx', b64(lying)))).toBe('import_file_unreadable');
    const inflated = Buffer.from(honest);
    inflated.writeUInt32LE(6 * 1024 * 1024, inflated.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
    expect(codeOf(() => decodeImportFile('mente2.xlsx', b64(inflated)))).toBe('import_file_unreadable');
  });

  it('refuses text that is not base64', () => {
    expect(codeOf(() => decodeImportFile('a.csv', 'não é base64!'))).toBe('import_file_unreadable');
  });
});

describe('csv parsing', () => {
  it('reads a semicolon file with accents, quoted fields and pt-BR decimals', async () => {
    const sheet = await parseCsv('Código;Descrição;Quantidade\r\n10;"Tinta; azul";2,5\r\n11;Verniz;3\r\n');
    expect(sheet.headers).toEqual(['Código', 'Descrição', 'Quantidade']);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0]?.cells).toEqual(['10', 'Tinta; azul', '2,5']);
    expect(sheet.rows[0]?.line).toBe(2);
  });

  it('reads a comma file with a BOM', async () => {
    const sheet = await parseCsv('﻿codigo,quantidade\n1,4\n');
    expect(sheet.headers).toEqual(['codigo', 'quantidade']);
    expect(sheet.rows[0]?.cells).toEqual(['1', '4']);
  });

  it('reads windows-1252 text', async () => {
    const { kind, bytes } = decodeImportFile('latin.csv', b64(Buffer.from('Descrição;Quantidade\nAçúcar;1\n', 'latin1')));
    const sheet = await parseSpreadsheet(kind, bytes);
    expect(sheet.headers[0]).toBe('Descrição');
    expect(sheet.rows[0]?.cells[0]).toBe('Açúcar');
  });

  it('refuses a file with no data rows and one over 50,000 rows', async () => {
    await expect(parseCsv('codigo;quantidade\n')).rejects.toMatchObject({ code: 'import_empty' });
    const many = `codigo;quantidade\n${'1;1\n'.repeat(50_001)}`;
    await expect(parseCsv(many)).rejects.toMatchObject({ code: 'import_too_many_rows' });
  });

  it('never evaluates a formula-looking cell: it stays text', async () => {
    const sheet = await parseCsv('codigo;quantidade\n=1+1;2\n');
    expect(sheet.rows[0]?.cells[0]).toBe('=1+1');
  });
});

describe('xlsx parsing', () => {
  it('round-trips a generated workbook (first sheet, header plus rows)', async () => {
    const buffer = await toXlsx({ sheet: 'Produtos', headers: ['Código', 'Descrição', 'Quantidade'], rows: [[10, 'Tinta', 3], [11, 'Verniz', null]] });
    const { kind, bytes } = decodeImportFile('modelo.xlsx', b64(buffer));
    expect(kind).toBe('xlsx');
    const sheet = await parseSpreadsheet(kind, bytes);
    expect(sheet.headers).toEqual(['Código', 'Descrição', 'Quantidade']);
    expect(sheet.rows[0]?.cells.slice(0, 3)).toEqual(['10', 'Tinta', '3']);
    expect(sheet.rows[1]?.cells[0]).toBe('11');
  });

  it('refuses a corrupt workbook with a reason, not a crash', async () => {
    const zip = makeZip({ 'nada.txt': Buffer.from('x') });
    const { kind, bytes } = decodeImportFile('quebrado.xlsx', b64(zip));
    await expect(parseSpreadsheet(kind, bytes)).rejects.toBeInstanceOf(ImportFileError);
  });
});

describe('column mapping', () => {
  it('suggests columns by header name, ignoring accents and case', () => {
    const mapping = suggestMapping('order_items', ['Código', 'Descrição', 'QTD']);
    expect(mapping).toEqual({ product: 'Código', quantity: 'QTD' });
  });

  it('reports the required fields that have no column, and honours a manual mapping', () => {
    const headers = ['A', 'B'];
    expect(missingRequired('order_items', suggestMapping('order_items', headers))).toEqual(['product', 'quantity']);
    const mapping = effectiveMapping('order_items', headers, { product: 'B', quantity: 'A', ghost: 'Z' });
    expect(mapping).toEqual({ product: 'B', quantity: 'A' });
    expect(missingRequired('order_items', mapping)).toEqual([]);
  });

  it('does not accept a header that is not in the file', () => {
    const mapping = effectiveMapping('order_items', ['A'], { product: 'A', quantity: 'inexistente' });
    expect(mapping.quantity).toBeNull();
  });
});

describe('row rules', () => {
  it('reads pt-BR quantities and rejects bad ones', () => {
    expect(readQuantity('2,5')).toEqual({ kind: 'ok', value: '2.5' });
    expect(readQuantity('3')).toEqual({ kind: 'ok', value: '3' });
    expect(readQuantity('  ')).toEqual({ kind: 'blank' });
    expect(readQuantity('abc').kind).toBe('invalid');
    expect(readQuantity('0').kind).toBe('invalid');
    expect(readQuantity('-1').kind).toBe('invalid');
    expect(readQuantity('1.000,5').kind).toBe('invalid');
    expect(readQuantity('1,23456').kind).toBe('invalid');
  });

  it('derives a stable request id per confirm and row', () => {
    const a = customerRowRequestId('0b0f2c5e-0000-4000-8000-000000000001', 2);
    expect(a).toBe(customerRowRequestId('0b0f2c5e-0000-4000-8000-000000000001', 2));
    expect(a).not.toBe(customerRowRequestId('0b0f2c5e-0000-4000-8000-000000000001', 3));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('export writers', () => {
  it('neutralizes formula injection in csv and writes a BOM with a semicolon delimiter', () => {
    expect(neutralizeFormula('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(neutralizeFormula('+1')).toBe("'+1");
    expect(neutralizeFormula('Tinta')).toBe('Tinta');
    const text = toCsv({ sheet: 'x', headers: ['Nome', 'Obs'], rows: [['=cmd', 'a;b'], ['Ana', null]] }).toString('utf8');
    expect(text.startsWith('﻿Nome;Obs\r\n')).toBe(true);
    expect(text).toContain("'=cmd;\"a;b\"");
    expect(text).toContain('Ana;');
  });
});
