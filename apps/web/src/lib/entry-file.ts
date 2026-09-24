import { MAX_ENTRY_BYTES } from "./bulk-entry";

/**
 * Turns a file chosen for "lançamento múltiplo" into the same `identifier;quantity` lines the paste box takes, so
 * one parser and one server-side resolution serve every source. Reading happens in the browser; the heavy readers
 * (Excel, PDF) are loaded only when such a file is picked.
 */

export type EntryFileKind = "text" | "excel" | "pdf";

export interface EntryFileResult {
  /** `identifier;quantity` lines, ready for `parseBulkEntry`. */
  text: string;
  /** PDF lines that did not look like `identifier quantity` and were not read. */
  ignoredLines: number;
}

export type EntryFileFailure = "too_large" | "unsupported" | "unreadable" | "too_many_pages";

export const entryFileFailureMessages: Record<EntryFileFailure, string> = {
  too_large: "O arquivo é grande demais (limite de 20 MB).",
  unsupported: "Formato não suportado. Use CSV, TXT, Excel (.xlsx) ou PDF com texto.",
  unreadable: "Não foi possível ler o arquivo. Confira se ele não está protegido por senha nem corrompido.",
  too_many_pages: "O PDF tem páginas demais (limite de 100). Divida o arquivo.",
};

export class EntryFileError extends Error {
  constructor(readonly reason: EntryFileFailure) {
    super(reason);
  }
}

const MAX_PDF_PAGES = 100;

export function entryFileKind(file: Pick<File, "name" | "type">): EntryFileKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) return "excel";
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (name.endsWith(".csv") || name.endsWith(".txt") || file.type === "text/csv" || file.type === "text/plain") return "text";
  return null;
}

/** A spreadsheet cell as the text a seller would have typed (pt-BR decimal comma). */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value).replace(".", ",");
  if (value instanceof Date) return "";
  return String(value).trim();
}

/** First two columns of every row: identifier and quantity. Semicolons/newlines inside cells would break the format. */
export function rowsToEntryText(rows: readonly (readonly unknown[])[]): string {
  return rows
    .map((row) => [cellText(row[0]), cellText(row[1])].map((cell) => cell.replace(/[;\t\r\n]+/g, " ")))
    .filter(([identifier]) => identifier !== "")
    .map(([identifier, quantity]) => (quantity === "" ? identifier : `${identifier};${quantity}`))
    .join("\n");
}

// "2001 5", "BL-09-VM  2,5": only a single identifier followed by a single number; "2001 - 5 UN" is not accepted.
const PDF_LINE = /^(\S+)\s+(\d+(?:[.,]\d+)?)$/;

/**
 * PDF text lines → entry lines. Only lines that are exactly `identifier quantity` are read; anything else (titles,
 * addresses, totals) is counted as ignored, never guessed at.
 */
export function pdfLinesToEntryText(lines: readonly string[]): EntryFileResult {
  const kept: string[] = [];
  let ignoredLines = 0;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line === "") continue;
    const match = PDF_LINE.exec(line);
    if (match === null) {
      ignoredLines += 1;
      continue;
    }
    kept.push(`${match[1]};${(match[2] ?? "").replace(".", ",")}`);
  }
  return { text: kept.join("\n"), ignoredLines };
}

async function readExcel(file: File): Promise<EntryFileResult> {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const rows = await readXlsxFile(file);
  return { text: rowsToEntryText(rows as unknown as readonly (readonly unknown[])[]), ignoredLines: 0 };
}

async function readPdf(file: File): Promise<EntryFileResult> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  if (pdf.numPages > MAX_PDF_PAGES) throw new EntryFileError("too_many_pages");
  const { text } = await extractText(pdf, { mergePages: true });
  return pdfLinesToEntryText(text.split(/\r\n|\n|\r/));
}

export async function readEntryFile(file: File): Promise<EntryFileResult> {
  // The size is checked before the file is read into memory.
  if (file.size > MAX_ENTRY_BYTES) throw new EntryFileError("too_large");
  const kind = entryFileKind(file);
  if (kind === null) throw new EntryFileError("unsupported");
  try {
    if (kind === "text") return { text: await file.text(), ignoredLines: 0 };
    return kind === "excel" ? await readExcel(file) : await readPdf(file);
  } catch (error) {
    if (error instanceof EntryFileError) throw error;
    throw new EntryFileError("unreadable");
  }
}
