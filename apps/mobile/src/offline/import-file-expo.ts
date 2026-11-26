import type { ImportFile } from "../data/imports";
import { fileProblem } from "../data/imports";

/** What the screen needs from the device: pick one spreadsheet and read it as base64. Device-only; tests use a double. */
export interface ImportFilePort {
  /** `null` when the user cancels. Throws `ImportFileError` (pt-BR message) for a refused or unreadable file. */
  pick(): Promise<ImportFile | null>;
}

export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFileError";
  }
}

/** expo-document-picker (system file chooser, no storage permission) + expo-file-system; modules load on first use. */
export function createExpoImportFile(): ImportFilePort {
  return {
    async pick() {
      const Picker = await import("expo-document-picker");
      const picked = await Picker.getDocumentAsync({
        type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv", "text/comma-separated-values", "application/csv", "application/vnd.ms-excel", "*/*"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || picked.assets.length === 0) return null;
      const asset = picked.assets[0]!;
      const problem = fileProblem(asset.name, asset.size ?? null);
      if (problem !== null) throw new ImportFileError(problem);
      const { File } = await import("expo-file-system");
      const file = new File(asset.uri);
      try {
        return { fileName: asset.name, contentBase64: await file.base64() };
      } catch {
        throw new ImportFileError("Não foi possível ler o arquivo.");
      } finally {
        try {
          file.delete();
        } catch {
          // best effort: the cache copy is purgeable by the OS
        }
      }
    },
  };
}
