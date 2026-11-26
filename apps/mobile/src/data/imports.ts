import type { ApiSchema } from "@salesforce/contracts/client";
import { ApiRequestError, callApi, type ApiClient } from "./api";
import { describeDataError } from "./errors";

/**
 * Spreadsheet import (RF-IMP), same function as the site: item list of a quotation for one customer, and customers in batch.
 * Online only: the server reads the file, shows what it recognised and creates the records on confirm. The server is the only
 * judge of what a file means. The representative imports but never exports (no export here).
 */

export type ImportKind = "order_items" | "customers";
export interface ImportRowIssue {
  readonly row: number;
  readonly reason: string;
}
/** Local mirror of `ImportPreviewSchema` (packages/contracts/src/imports.ts) until the generated types carry it. */
export interface ImportPreview {
  readonly type: ImportKind;
  readonly fields: readonly { id: string; label: string; required: boolean }[];
  readonly headers: readonly string[];
  readonly mapping: Record<string, string | null>;
  readonly missingRequired: readonly string[];
  readonly totalRows: number;
  readonly recognized: number;
  readonly rejected: number;
  readonly skippedBlank: number;
  readonly sample: readonly { row: number; ok: boolean; label: string | null; quantity: string | null; reason: string | null }[];
  readonly errors: readonly ImportRowIssue[];
  readonly errorsTruncated: boolean;
}
/** Local mirror of `ImportResultSchema`. */
export interface ImportResult {
  readonly type: ImportKind;
  readonly created: number;
  readonly rejected: number;
  readonly pending: number;
  readonly skippedBlank: number;
  readonly orderId: string | null;
  readonly draftNumber: number | null;
  readonly errors: readonly ImportRowIssue[];
  readonly errorsTruncated: boolean;
}
export type DatasetIdentity = ApiSchema<"DatasetIdentity">;

/** Same limit as the contract (`IMPORT_MAX_FILE_BYTES`); the server stays authoritative. */
export const IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Same limit as the contract (`IMPORT_MAX_CUSTOMER_ROWS`). */
export const IMPORT_MAX_CUSTOMER_ROWS = 30;

export interface ImportFile {
  readonly fileName: string;
  /** Base64 text, no data-URL prefix. */
  readonly contentBase64: string;
}

export interface ImportRequestBase {
  readonly type: ImportKind;
  readonly file: ImportFile;
  readonly customerCode?: number;
  readonly mapping?: Record<string, string | null>;
}

export interface ImportConfirmInput extends ImportRequestBase {
  readonly clientRequestId: string;
  readonly expectedDataset?: DatasetIdentity;
}

export interface ImportsPort {
  preview(input: ImportRequestBase): Promise<ImportPreview>;
  confirm(input: ImportConfirmInput): Promise<ImportResult>;
  /** The dataset identity the server runs under (required when a quotation is created). */
  dataset(): Promise<DatasetIdentity | null>;
}

function bodyOf(input: ImportRequestBase) {
  return {
    type: input.type,
    fileName: input.file.fileName,
    contentBase64: input.file.contentBase64,
    ...(input.customerCode === undefined ? {} : { customerCode: input.customerCode }),
    ...(input.mapping === undefined ? {} : { mapping: input.mapping }),
  };
}

export function createImportsPort(api: ApiClient): ImportsPort {
  return {
    preview: (input) => callApi(() => api.POST("/imports/preview", { body: bodyOf(input) })),
    confirm: (input) =>
      callApi(() =>
        api.POST("/imports/confirm", {
          body: { ...bodyOf(input), clientRequestId: input.clientRequestId, ...(input.expectedDataset === undefined ? {} : { expectedDataset: input.expectedDataset }) },
        }),
      ),
    async dataset() {
      const configuration = await callApi(() => api.GET("/order-entry/configuration"));
      const found = configuration.dataset;
      return found === null ? null : { environment: found.environment, datasetId: found.datasetId };
    },
  };
}

/** Size of the decoded file inside base64 text. */
export function decodedBytesOfBase64(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** pt-BR reason a chosen file is refused before any upload, or `null` when it can go. */
export function fileProblem(name: string, sizeBytes: number | null): string | null {
  if (!/\.(xlsx|csv)$/i.test(name)) return "Escolha um arquivo .xlsx ou .csv.";
  if (sizeBytes !== null && sizeBytes > IMPORT_MAX_FILE_BYTES) return "O arquivo é grande demais (limite de 20 MB).";
  return null;
}

/** The confirm button is enabled only for a readable file with something recognised and every required field mapped. */
export function canConfirmImport(preview: ImportPreview | null, type: ImportKind, customerCode: number | null): boolean {
  if (preview === null) return false;
  if (type === "order_items" && customerCode === null) return false;
  return preview.missingRequired.length === 0 && preview.recognized > 0;
}

/** The next mapping after the user picks a column (empty header = "Não importar"). */
export function remap(current: Record<string, string | null>, field: string, header: string): Record<string, string | null> {
  return { ...current, [field]: header === "" ? null : header };
}

/** Unrecognised lines as shareable text: one "Linha N: motivo" per line. */
export function errorReportText(errors: readonly { row: number; reason: string }[]): string {
  return errors.map((error) => `Linha ${error.row}: ${error.reason}`).join("\n");
}

/** Outcome line of a finished import. */
export function resultSummary(result: ImportResult): string {
  const one = result.created === 1;
  const done = result.type === "customers" ? `${result.created} ${one ? "cliente cadastrado" : "clientes cadastrados"}` : `${result.created} ${one ? "item" : "itens"} no orçamento`;
  const parts = [done];
  if (result.pending > 0) parts.push(`${result.pending} aguardando o ERP`);
  if (result.rejected > 0) parts.push(`${result.rejected} com erro`);
  return parts.join(" · ");
}

/** User-facing pt-BR text of a failed import call; the server's own text is kept for refusals it explains. */
export function describeImportError(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    if (error.isNetwork) return "Sem conexão com o servidor. A importação só funciona online.";
    if (error.status === 409 && error.code === "dataset_mismatch") return "Os dados deste aparelho são de outra base. Sincronize e tente de novo.";
    if (error.status === 413) return "O arquivo é grande demais (limite de 20 MB).";
    if ((error.status === 400 || error.status === 409 || error.status === 422) && error.message !== "" && !/^HTTP \d+$/.test(error.message)) return error.message;
    return describeDataError(error).message;
  }
  return fallback;
}
