/**
 * Device adapters for `apk-update.ts` (expo-file-system, expo-intent-launcher). Thin on purpose: all decisions live in the
 * pure module. Not unit-tested (native); it needs a real Android device to validate, see docs/downloads-center.md.
 */
import * as Application from "expo-application";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import { Platform } from "react-native";
import { checkAndUpdate, type UpdateIo, type UpdateResult, type UpdateStep } from "./apk-update";
import { Sha256 } from "./sha256";

const FLAG_GRANT_READ_URI_PERMISSION = 1;
const FLAG_ACTIVITY_NEW_TASK = 268435456;
const APK_MIME = "application/vnd.android.package-archive";
const UPDATE_DIR = "apk-update";

function updateDirectory(): Directory {
  const dir = new Directory(Paths.cache, UPDATE_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function createDeviceIo(): UpdateIo {
  return {
    async fetchJson(url) {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`manifest ${response.status}`);
      return response.json();
    },
    async download(url, onProgress) {
      const dir = updateDirectory();
      for (const stale of dir.list()) stale.delete(); // one pending update at a time
      const target = new File(dir, "update.apk");
      const file = await File.downloadFileAsync(url, target, {
        idempotent: true,
        onProgress: ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => onProgress(bytesWritten, totalBytes),
      });
      return file.uri;
    },
    fileSize: (path) => new File(path).size ?? -1,
    readChunks(path, chunkBytes, consume) {
      const handle = new File(path).open(FileMode.ReadOnly);
      try {
        for (;;) {
          const chunk = handle.readBytes(chunkBytes);
          if (chunk.length === 0) break;
          consume(chunk);
        }
      } finally {
        handle.close();
      }
    },
    remove(path) {
      const file = new File(path);
      if (file.exists) file.delete();
    },
    async openInstaller(path) {
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: new File(path).contentUri,
        type: APK_MIME,
        flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
      });
    },
  };
}

/** Installed `versionCode` (Android only); `null` elsewhere or when unreadable, which disables the updater. */
export function installedVersionCode(): number | null {
  if (Platform.OS !== "android") return null;
  const parsed = Number(Application.nativeBuildVersion);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export interface RunUpdateOptions {
  readonly apiOrigin: string;
  readonly channel: string | undefined;
  readonly onStep?: (step: UpdateStep, progress?: { written: number; total: number }) => void;
  readonly confirm?: Parameters<typeof checkAndUpdate>[0]["confirm"];
}

export async function runApkUpdate(options: RunUpdateOptions): Promise<UpdateResult> {
  const versionCode = installedVersionCode();
  if (versionCode === null) return { kind: "unavailable", reason: "no-channel" };
  return checkAndUpdate({ io: createDeviceIo(), sha256: () => new Sha256(), installedVersionCode: versionCode, ...options });
}
