import { useEffect, useState, type ReactNode } from "react";
import type { StartupCheck } from "../update/startup-check";
import { RequiredUpdateScreen } from "./required-update-screen";

export interface UpdateGateProps {
  /** Absent when this build has no update channel (development, non-Android): the gate is transparent. */
  readonly check?: () => Promise<StartupCheck>;
  readonly install: (onStatus: (text: string) => void) => Promise<string>;
  readonly children: ReactNode;
}

/** Renders the app immediately; only a confirmed "required" result replaces it with the blocking screen. */
export function UpdateGate({ check, install, children }: UpdateGateProps) {
  const [required, setRequired] = useState<string | null>(null);
  useEffect(() => {
    if (!check) return undefined;
    let active = true;
    check().then(
      (result) => {
        if (active && result.kind === "required") setRequired(result.release.versionName);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [check]);
  if (required !== null) return <RequiredUpdateScreen versionName={required} onInstall={install} />;
  return <>{children}</>;
}
