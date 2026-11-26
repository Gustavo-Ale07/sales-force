import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// Short commit of the build: BUILD_SHA (docker build arg) first, then git when available, else empty (no git in the image).
function buildCommit(): string {
  const fromEnv = (process.env.BUILD_SHA ?? "").trim();
  if (/^[0-9a-f]{7,40}$/i.test(fromEnv)) return fromEnv.slice(0, 7).toLowerCase();
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

// The browser only ever talks to its own origin (`/api`); in development Vite proxies it to the API process.
const apiProxy = { "/api": { target: "http://127.0.0.1:3000", changeOrigin: false } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version), __APP_COMMIT__: JSON.stringify(buildCommit()) },
  server: { port: 5173, strictPort: true, proxy: apiProxy },
  preview: { port: 4173, proxy: apiProxy },
  build: { sourcemap: false, target: "es2022" },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    css: false,
    globals: false,
  },
});
