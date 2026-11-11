import { apiConfig } from "../config";
import { createDeviceIo, installedVersionCode, runApkUpdate } from "./apk-update-io";
import { runStartupCheck, type StartupCheck } from "./startup-check";
import { updateResultMessage, updateStepMessage } from "./update-messages";

// Update channel = build profile; only distributable builds (staging) have one. Inlined by Expo at bundle time.
const channel: string | undefined = process.env.EXPO_PUBLIC_BUILD_PROFILE === "staging" ? "staging" : undefined;
const origin: string | undefined = apiConfig.ok ? new URL(apiConfig.baseUrl).origin : undefined;

/** True when this build can update itself (Android, staging channel, https API origin). */
export const updateAvailable: boolean = channel !== undefined && origin !== undefined && installedVersionCode() !== null;

/** Stable reference (the gate runs it once per mount). Undefined when this build has no update channel. */
export const startupUpdateCheck: (() => Promise<StartupCheck>) | undefined = updateAvailable
  ? () => {
      const versionCode = installedVersionCode();
      if (versionCode === null || origin === undefined) return Promise.resolve<StartupCheck>({ kind: "open" });
      return runStartupCheck({ io: createDeviceIo(), apiOrigin: origin, channel, installedVersionCode: versionCode });
    }
  : undefined;

/** Downloads, verifies and opens the installer; resolves with the pt-BR message to show. */
export async function installUpdate(onStatus: (text: string) => void): Promise<string> {
  if (origin === undefined) return updateResultMessage({ kind: "unavailable", reason: "no-channel" });
  return updateResultMessage(await runApkUpdate({ apiOrigin: origin, channel, onStep: (step, progress) => onStatus(updateStepMessage(step, progress)) }));
}
