import { createContext, useContext, type ReactNode } from "react";
import type { AuthClient } from "./auth-client";
import type { RuntimeConfig } from "./runtime-config";

export interface AppServices {
  config: RuntimeConfig;
  authClient: AuthClient;
}

const AppContext = createContext<AppServices | null>(null);

export function AppServicesProvider({ value, children }: { value: AppServices; children: ReactNode }) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppServices(): AppServices {
  const value = useContext(AppContext);
  if (!value) throw new Error("AppServicesProvider ausente");
  return value;
}
