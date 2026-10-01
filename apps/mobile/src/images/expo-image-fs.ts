import { Directory, File, Paths } from "expo-file-system";
import type { ImageFileSystem } from "./image-fs";

/**
 * App-private storage (document directory: not shared, not reachable by other apps). Thumbnails are re-fetchable, but
 * offline reuse is the point, so they are not placed in the OS-purgeable cache directory. Native module: exercised on
 * a device only (the unit tests use the in-memory port).
 */
export function createExpoImageFileSystem(directoryName = "product-images"): ImageFileSystem {
  const directory = () => {
    const dir = new Directory(Paths.document, directoryName);
    dir.create({ intermediates: true, idempotent: true });
    return dir;
  };
  const file = (name: string) => new File(directory(), name);
  return {
    async readText(name) {
      const target = file(name);
      return target.exists ? target.text() : null;
    },
    async writeText(name, text) {
      const target = file(name);
      if (!target.exists) target.create({ intermediates: true });
      target.write(text);
    },
    async writeBytes(name, bytes) {
      const target = file(name);
      if (!target.exists) target.create({ intermediates: true });
      target.write(bytes);
    },
    async exists(name) {
      return file(name).exists;
    },
    uri: (name) => file(name).uri,
    async remove(name) {
      const target = file(name);
      if (target.exists) target.delete();
    },
    async clear() {
      const dir = new Directory(Paths.document, directoryName);
      if (dir.exists) dir.delete();
    },
  };
}
