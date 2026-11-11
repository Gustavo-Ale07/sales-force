import { checkUpdateNeed, type LatestRelease, type UpdateDeps } from "./apk-update";

export type StartupCheck = { readonly kind: "open" } | { readonly kind: "required"; readonly release: LatestRelease };

/**
 * Background check made when the app opens. It never delays or blocks the app: offline, timeout, bad manifest or any error
 * resolves to `open`, so the app keeps working offline. Only a verified manifest saying the installed build is below
 * `minVersionCode` yields `required`.
 */
export async function runStartupCheck(deps: Pick<UpdateDeps, "io" | "apiOrigin" | "channel" | "installedVersionCode">, timeoutMs = 8000): Promise<StartupCheck> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<StartupCheck>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "open" }), timeoutMs);
  });
  const check = checkUpdateNeed(deps).then(
    (need): StartupCheck => (need.kind === "required" ? { kind: "required", release: need.release } : { kind: "open" }),
    (): StartupCheck => ({ kind: "open" }),
  );
  try {
    return await Promise.race([check, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
