import appConfig from "../app.json";

/** Product name shown to the seller. */
export const PRODUCT_NAME = "Force";

export const APP_VERSION: string = appConfig.expo.version;

/** The slice of expo-updates the build label needs; injectable so tests do not touch the native module. */
export interface UpdatesInfo {
  readonly updateId: string | null;
  readonly isEmbeddedLaunch: boolean;
}

/** "0.1.0 · atualização a1b2c3d" when an OTA update runs, "0.1.0 · pacote do APK" for the embedded bundle. */
export function buildLabel(version: string, updates: UpdatesInfo): string {
  if (updates.isEmbeddedLaunch || updates.updateId === null || updates.updateId === "") return `${version} · pacote do APK`;
  return `${version} · atualização ${updates.updateId.slice(0, 7)}`;
}

function readUpdates(): UpdatesInfo {
  try {
    // Lazy require: a missing or inert native module must never break the app shell.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Updates = require("expo-updates") as { updateId?: string | null; isEmbeddedLaunch?: boolean };
    return { updateId: Updates.updateId ?? null, isEmbeddedLaunch: Updates.isEmbeddedLaunch ?? true };
  } catch {
    return { updateId: null, isEmbeddedLaunch: true };
  }
}

export const APP_BUILD_LABEL: string = buildLabel(APP_VERSION, readUpdates());

/**
 * Environment badge. Only non-production builds show one: a development bundle (`__DEV__`) or a build made with
 * `EXPO_PUBLIC_APP_ENV=dev`. A production build shows no badge.
 */
export const APP_ENVIRONMENT_LABEL: string | null = __DEV__ || process.env.EXPO_PUBLIC_APP_ENV === "dev" ? "DEV" : null;
