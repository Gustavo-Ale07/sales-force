/**
 * Minimal file-system port of the product-image store. Every name is a flat file name inside ONE app-private
 * directory; the store never builds paths. The Expo adapter lives in `expo-image-fs.ts`; tests use an in-memory one.
 */
export interface ImageFileSystem {
  readText(name: string): Promise<string | null>;
  writeText(name: string, text: string): Promise<void>;
  writeBytes(name: string, bytes: Uint8Array): Promise<void>;
  exists(name: string): Promise<boolean>;
  /** `file://` uri for the native Image component. */
  uri(name: string): string;
  remove(name: string): Promise<void>;
  /** Deletes every file of the directory. */
  clear(): Promise<void>;
}
