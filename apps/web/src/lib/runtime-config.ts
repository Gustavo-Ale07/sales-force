/**
 * Runtime configuration (STACK-5 / no environment values baked into the bundle).
 *
 * `/config.json` is served next to the SPA and can be replaced per installation without rebuilding.
 * It must never contain secrets. The API is always same-origin `/api`, so no URL is configurable here.
 */
export type AuthMode = "dev" | "standard";

export interface RuntimeConfig {
  /** Name shown in the shell and on the login page. Installation-specific, never hard-coded in code. */
  installationName: string;
  /**
   * `dev` shows the visible "development authentication" banners. Defaults to `dev` when the file is missing or
   * invalid so that a misconfiguration fails visible (the server refuses dev auth in production anyway).
   */
  authMode: AuthMode;
}

export const defaultRuntimeConfig: RuntimeConfig = {
  installationName: "Sales Force",
  authMode: "dev",
};

export function parseRuntimeConfig(input: unknown): RuntimeConfig {
  if (typeof input !== "object" || input === null) return defaultRuntimeConfig;
  const raw = input as Record<string, unknown>;
  const name = typeof raw.installationName === "string" ? raw.installationName.trim() : "";
  return {
    installationName: name.length > 0 && name.length <= 60 ? name : defaultRuntimeConfig.installationName,
    authMode: raw.authMode === "standard" ? "standard" : "dev",
  };
}

export async function loadRuntimeConfig(fetchImpl: typeof fetch = fetch): Promise<RuntimeConfig> {
  try {
    const response = await fetchImpl("/config.json", { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) return defaultRuntimeConfig;
    return parseRuntimeConfig(await response.json());
  } catch {
    return defaultRuntimeConfig;
  }
}
