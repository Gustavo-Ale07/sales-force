import type { ApiSchema } from "@salesforce/contracts/client";
import { ApiRequestError, API_BASE_PATH, callApi, fetchWithServerCode, toApiRequestError, type ApiClient } from "./api";

/** Spreadsheet import (RF-IMP) and CSV/XLSX export (RF-DSH-6). The server is the only judge of what a file means and who may export. */

export type ImportPreviewBody = ApiSchema<"ImportPreviewRequest">;
export type ImportConfirmBody = ApiSchema<"ImportConfirmRequest">;
export type ImportPreview = ApiSchema<"ImportPreview">;
export type ImportResult = ApiSchema<"ImportResult">;
export type ImportKind = ApiSchema<"ImportType">;

/** Largest file the server accepts (20 MB); checked here only to avoid reading a huge file into memory. */
export const IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024;

export function previewImport(api: ApiClient, body: ImportPreviewBody) {
  return callApi(() => api.POST("/imports/preview", { body }));
}

export function confirmImport(api: ApiClient, body: ImportConfirmBody) {
  return callApi(() => api.POST("/imports/confirm", { body }));
}

/** The chosen file as base64 text (no data-URL prefix). */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("unreadable"));
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      resolve(text.slice(text.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

function fileNameOf(response: Response, fallback: string): string {
  const header = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] ?? fallback;
}

/** Saves a text/bytes blob through the browser, never navigating away. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** GET of a binary route with the session cookie; the response is saved as a file. Failures become `ApiRequestError`. */
export async function downloadFile(path: string, query: Record<string, string | number | undefined>, fallbackName: string): Promise<void> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  let response: Response;
  try {
    response = await fetchWithServerCode(new Request(`${window.location.origin}${API_BASE_PATH}${path}${suffix}`, { credentials: "same-origin" }));
  } catch {
    throw new ApiRequestError({ status: 0, message: "Sem conexão com o servidor." });
  }
  if (!response.ok) throw toApiRequestError(response, await response.json().catch(() => undefined));
  saveBlob(await response.blob(), fileNameOf(response, fallbackName));
}

/** Error report of an import as CSV (`;`, UTF-8 with BOM), one line per rejected row. */
export function errorReportCsv(errors: readonly { row: number; reason: string }[]): Blob {
  const lines = ["Linha;Motivo", ...errors.map((error) => `${error.row};"${error.reason.replace(/"/g, '""')}"`)];
  return new Blob([`\ufeff${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
}
