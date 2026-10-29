import { mergeConfig } from "vite";
import base from "../vite.config";
import { E2E_API_ORIGIN, E2E_WEB_PORT } from "./support/env";

/**
 * The application's own Vite configuration with only the ports changed: the browser talks to its own origin and
 * Vite proxies `/api` to the throwaway API process. A separate cache directory keeps this instance from sharing
 * pre-bundled dependencies with a developer's running Vite.
 */
export default mergeConfig(base, {
  cacheDir: "node_modules/.vite-e2e",
  server: {
    host: "127.0.0.1",
    port: E2E_WEB_PORT,
    strictPort: true,
    proxy: { "/api": { target: E2E_API_ORIGIN } },
  },
});
