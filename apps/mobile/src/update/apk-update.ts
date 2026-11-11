/**
 * In-app APK update (stage B, layer 2). Pure logic with injected I/O so it is fully unit-tested; the real adapters
 * (expo-file-system, expo-intent-launcher) live in `apk-update-io.ts`.
 *
 * Flow: read `/downloads-files/latest-<channel>.json` from the API origin (HTTPS only) -> compare the installed
 * `versionCode` -> download the APK -> check size and SHA-256 (incremental, in chunks) -> only then hand the file to the
 * Android installer. A mismatch deletes the file and never reaches the installer. The server cannot make the app
 * install anything the digest in its own JSON does not describe, and Android still verifies the signature on install.
 */
const SHA256 = /^[0-9a-f]{64}$/;
const APK_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.apk$/;
const CHANNEL = /^[a-z][a-z0-9-]{0,20}$/;

export interface LatestRelease {
  readonly channel: string;
  readonly versionName: string;
  readonly versionCode: number;
  readonly minVersionCode: number;
  readonly file: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export type UpdateDecision = "none" | "available" | "required";

export type UpdateStep = "checking" | "downloading" | "verifying" | "installing";

export type UpdateResult =
  | { readonly kind: "up-to-date" }
  | { readonly kind: "unavailable"; readonly reason: "no-channel" | "insecure-origin" | "network" | "invalid-manifest" }
  | { readonly kind: "installer-opened"; readonly release: LatestRelease }
  | { readonly kind: "skipped"; readonly release: LatestRelease }
  | { readonly kind: "failed"; readonly reason: "download" | "size-mismatch" | "digest-mismatch" | "install"; readonly release: LatestRelease };

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Validates the untrusted manifest; `null` when anything is off (including a channel that is not the expected one). */
export function parseLatest(input: unknown, expectedChannel: string): LatestRelease | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const versionCode = positiveInt(raw.versionCode);
  const minVersionCode = positiveInt(raw.minVersionCode);
  const sizeBytes = positiveInt(raw.sizeBytes);
  if (raw.channel !== expectedChannel || versionCode === null || minVersionCode === null || sizeBytes === null) return null;
  if (minVersionCode > versionCode) return null;
  if (typeof raw.file !== "string" || !APK_FILE.test(raw.file)) return null;
  if (typeof raw.sha256 !== "string" || !SHA256.test(raw.sha256)) return null;
  if (typeof raw.versionName !== "string" || raw.versionName.length === 0 || raw.versionName.length > 30) return null;
  return { channel: expectedChannel, versionName: raw.versionName, versionCode, minVersionCode, file: raw.file, sha256: raw.sha256, sizeBytes };
}

/** `required` when the installed build is below the minimum: the UI must block use until it updates. */
export function decideUpdate(installedVersionCode: number, latest: LatestRelease): UpdateDecision {
  if (installedVersionCode >= latest.versionCode) return "none";
  return installedVersionCode < latest.minVersionCode ? "required" : "available";
}

export function manifestUrl(apiOrigin: string, channel: string): string | null {
  if (!CHANNEL.test(channel)) return null;
  return `${apiOrigin}/downloads-files/latest-${channel}.json`;
}

export function apkUrl(apiOrigin: string, release: LatestRelease): string {
  return `${apiOrigin}/downloads-files/${release.file}`;
}

/** What the update needs from the device. */
export interface UpdateIo {
  fetchJson(url: string): Promise<unknown>;
  /** Downloads to a private cache file; resolves with its path. Rejects on any failure. */
  download(url: string, onProgress: (written: number, total: number) => void): Promise<string>;
  fileSize(path: string): number;
  /** Reads the file in chunks, feeding each one to `consume`. */
  readChunks(path: string, chunkBytes: number, consume: (chunk: Uint8Array) => void): void;
  remove(path: string): void;
  openInstaller(path: string): Promise<void>;
}

export interface UpdateDeps {
  readonly io: UpdateIo;
  readonly sha256: () => { update(data: Uint8Array): unknown; digestHex(): string };
  /** `https://host` (no path). */
  readonly apiOrigin: string;
  readonly channel: string | undefined;
  readonly installedVersionCode: number;
  readonly onStep?: (step: UpdateStep, progress?: { written: number; total: number }) => void;
  /** Lets the UI ask the user before a non-required update downloads; required updates never ask. */
  readonly confirm?: (decision: Exclude<UpdateDecision, "none">, release: LatestRelease) => Promise<boolean>;
}

const CHUNK = 256 * 1024;

export type UpdateNeed =
  | { readonly kind: "none" }
  | { readonly kind: "available" | "required"; readonly release: LatestRelease }
  | { readonly kind: "unavailable"; readonly reason: "no-channel" | "insecure-origin" | "network" | "invalid-manifest" };

/** Reads the manifest and decides; downloads nothing. Never throws: any failure is `unavailable`. */
export async function checkUpdateNeed(deps: Pick<UpdateDeps, "io" | "apiOrigin" | "channel" | "installedVersionCode" | "onStep">): Promise<UpdateNeed> {
  if (!deps.channel) return { kind: "unavailable", reason: "no-channel" };
  if (!deps.apiOrigin.startsWith("https://")) return { kind: "unavailable", reason: "insecure-origin" };
  const url = manifestUrl(deps.apiOrigin, deps.channel);
  if (!url) return { kind: "unavailable", reason: "no-channel" };
  deps.onStep?.("checking");
  let manifest: unknown;
  try {
    manifest = await deps.io.fetchJson(url);
  } catch {
    return { kind: "unavailable", reason: "network" };
  }
  const release = parseLatest(manifest, deps.channel);
  if (!release) return { kind: "unavailable", reason: "invalid-manifest" };
  const decision = decideUpdate(deps.installedVersionCode, release);
  return decision === "none" ? { kind: "none" } : { kind: decision, release };
}

export async function checkAndUpdate(deps: UpdateDeps): Promise<UpdateResult> {
  const need = await checkUpdateNeed(deps);
  if (need.kind === "unavailable") return need;
  if (need.kind === "none") return { kind: "up-to-date" };
  const { release, kind: decision } = need;
  if (decision === "available" && deps.confirm && !(await deps.confirm(decision, release))) return { kind: "skipped", release };

  deps.onStep?.("downloading");
  let path: string;
  try {
    path = await deps.io.download(apkUrl(deps.apiOrigin, release), (written, total) => deps.onStep?.("downloading", { written, total }));
  } catch {
    return { kind: "failed", reason: "download", release };
  }
  deps.onStep?.("verifying");
  try {
    if (deps.io.fileSize(path) !== release.sizeBytes) {
      deps.io.remove(path);
      return { kind: "failed", reason: "size-mismatch", release };
    }
    const hash = deps.sha256();
    deps.io.readChunks(path, CHUNK, (chunk) => hash.update(chunk));
    if (hash.digestHex() !== release.sha256) {
      deps.io.remove(path);
      return { kind: "failed", reason: "digest-mismatch", release };
    }
  } catch {
    try {
      deps.io.remove(path);
    } catch {
      /* best effort */
    }
    return { kind: "failed", reason: "digest-mismatch", release };
  }
  deps.onStep?.("installing");
  try {
    await deps.io.openInstaller(path);
  } catch {
    return { kind: "failed", reason: "install", release };
  }
  return { kind: "installer-opened", release };
}
