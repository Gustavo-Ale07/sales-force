import type { ImageFileSystem } from "./image-fs";
import type { ImageFetchOutcome } from "./image-store";

/** In-memory file system for the product-image store: no native module. */
export function memoryImageFileSystem() {
  const files = new Map<string, string | Uint8Array>();
  const fs: ImageFileSystem = {
    readText: async (name) => {
      const value = files.get(name);
      return typeof value === "string" ? value : null;
    },
    writeText: async (name, text) => void files.set(name, text),
    writeBytes: async (name, bytes) => void files.set(name, bytes),
    exists: async (name) => files.has(name),
    uri: (name) => `file:///images/${name}`,
    remove: async (name) => void files.delete(name),
    clear: async () => files.clear(),
  };
  return { fs, files };
}

export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
export const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
export const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);
export const GARBAGE = Uint8Array.from([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]); // "<html>"

export const ok = (bytes: Uint8Array): ImageFetchOutcome => ({ kind: "ok", bytes });
