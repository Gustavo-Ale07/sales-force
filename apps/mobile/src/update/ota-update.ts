/** Slice of expo-updates the manual OTA cycle needs; injectable so tests never touch the native module. */
export interface UpdatesPort {
  readonly isEnabled: boolean;
  checkForUpdateAsync(): Promise<{ readonly isAvailable: boolean }>;
  fetchUpdateAsync(): Promise<{ readonly isNew?: boolean }>;
  reloadAsync(): Promise<void>;
}

export type OtaOutcome = "none" | "reloading" | "offline" | "failed";

type Hook = () => Promise<void> | void;
const beforeReloadHooks = new Set<Hook>();

/** Screens holding unsaved in-memory work register a save here; it runs before the app restarts. Returns the unregister. */
export function registerBeforeReload(hook: Hook): () => void {
  beforeReloadHooks.add(hook);
  return () => void beforeReloadHooks.delete(hook);
}

export async function runBeforeReloadHooks(): Promise<void> {
  for (const hook of [...beforeReloadHooks]) await hook();
}

function isNetworkError(error: unknown): boolean {
  const text = `${(error as { code?: string } | null)?.code ?? ""} ${(error as Error | null)?.message ?? ""}`.toLowerCase();
  return /network|offline|internet|timed? ?out|unable to resolve|connect|fetch/.test(text);
}

/**
 * Check -> download -> save local work -> restart on the new bundle. No new update = "none" (nothing changes).
 * Local work is saved before reloadAsync; if the save fails the app is NOT restarted (nothing is lost, "failed").
 */
export async function runOtaUpdate(updates: UpdatesPort, beforeReload: () => Promise<void> = runBeforeReloadHooks): Promise<OtaOutcome> {
  if (!updates.isEnabled) return "none";
  try {
    const check = await updates.checkForUpdateAsync();
    if (!check.isAvailable) return "none";
    await updates.fetchUpdateAsync();
  } catch (error) {
    return isNetworkError(error) ? "offline" : "failed";
  }
  try {
    await beforeReload();
    await updates.reloadAsync();
  } catch {
    return "failed";
  }
  return "reloading";
}
