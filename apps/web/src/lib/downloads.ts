/**
 * Downloads center (stage B). The list of installable apps is configuration, not code: `downloads.json` is
 * published next to the APK files by `scripts/publish-android.mjs` and served under `/downloads-files/`.
 * The file is public and editable per installation, so every field is validated here before it reaches the
 * DOM: file names are flat (no path tricks) with an `.apk` extension, the digest is a SHA-256 hex string, and
 * anything else drops the entry. Nothing here ever throws.
 */
export const DOWNLOADS_BASE = "/downloads-files";
export const DOWNLOADS_INDEX_URL = `${DOWNLOADS_BASE}/downloads.json`;

export interface DownloadItem {
  id: string;
  platform: "android";
  channel: string;
  label: string;
  versionName: string;
  versionCode: number;
  /** Installed builds below this code must update before use (read by the mobile updater from latest.json). */
  minVersionCode: number;
  /** Same-origin URL of the APK. */
  url: string;
  sha256: string;
  sizeBytes: number;
  publishedAt: string | null;
  notes: string | null;
}

const APK_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.apk$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const CHANNEL = /^[a-z][a-z0-9-]{0,20}$/;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function parseDownloadItem(input: unknown): DownloadItem | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const id = typeof raw.id === "string" && ID.test(raw.id) ? raw.id : null;
  const channel = typeof raw.channel === "string" && CHANNEL.test(raw.channel) ? raw.channel : null;
  const label = text(raw.label, 60);
  const versionName = text(raw.versionName, 30);
  const versionCode = positiveInt(raw.versionCode);
  const sizeBytes = positiveInt(raw.sizeBytes);
  const file = typeof raw.file === "string" && APK_FILE.test(raw.file) ? raw.file : null;
  const sha256 = typeof raw.sha256 === "string" && SHA256.test(raw.sha256) ? raw.sha256 : null;
  if (raw.platform !== "android" || !id || !channel || !label || !versionName || !versionCode || !sizeBytes || !file || !sha256) return null;
  const min = raw.minVersionCode === undefined ? 1 : positiveInt(raw.minVersionCode);
  if (min === null || min > versionCode) return null;
  const published = typeof raw.publishedAt === "string" && !Number.isNaN(Date.parse(raw.publishedAt)) ? raw.publishedAt : null;
  return {
    id,
    platform: "android",
    channel,
    label,
    versionName,
    versionCode,
    minVersionCode: min,
    url: `${DOWNLOADS_BASE}/${file}`,
    sha256,
    sizeBytes,
    publishedAt: published,
    notes: text(raw.notes, 400),
  };
}

/** Newest first; invalid entries are dropped, a malformed document yields an empty list. */
export function parseDownloads(input: unknown): DownloadItem[] {
  if (typeof input !== "object" || input === null) return [];
  const items = (input as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [];
  return items
    .map(parseDownloadItem)
    .filter((item): item is DownloadItem => item !== null)
    .sort((a, b) => b.versionCode - a.versionCode);
}

export async function loadDownloads(fetchImpl: typeof fetch = fetch): Promise<DownloadItem[]> {
  const response = await fetchImpl(DOWNLOADS_INDEX_URL, { cache: "no-store", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`downloads index ${response.status}`);
  return parseDownloads(await response.json());
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
