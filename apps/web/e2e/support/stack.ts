import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import {
  E2E_API_ORIGIN,
  E2E_API_PORT,
  E2E_PG_CONTAINER,
  E2E_PG_PORT,
  E2E_WEB_ORIGIN,
  E2E_WEB_PORT,
  assertNotDeveloperStack,
} from "./env";

/**
 * Throwaway full stack for the web E2E suite: PostgreSQL 17 in its own container (no volume), the real migrations,
 * pg-boss queues, the synthetic demo seed, one mirror synchronization from the FAKE Sankhya gateway, the API process
 * and the Vite dev server. Nothing here reads or writes a `.env`, and nothing touches the developer stack
 * (different ports and container name, checked before anything starts). Only what this module started is stopped.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const webRoot = path.join(repoRoot, "apps/web");
const serverRoot = path.join(repoRoot, "apps/server");
const isWindows = process.platform === "win32";

const DB_NAME = "salesforce_e2e";

/** Variables that must never leak from the developer's shell into the throwaway stack. */
const SCRUBBED_ENV = /^(SANKHYA_|SF_CONFIG_FILE$|DATABASE_URL$|API_|ALLOWED_ORIGINS$|SEED_|SYNC_|WORKER_|AUTH_MODE$|ALLOW_DEV_AUTH$|NODE_ENV$|LOG_LEVEL$|PASSWORD_HASH_|SESSION_|LOGIN_|TRUST_PROXY$|DB_)/;

function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!SCRUBBED_ENV.test(key)) env[key] = value;
  }
  return { ...env, ...extra };
}

function log(message: string): void {
  process.stdout.write(`[e2e-stack] ${message}\n`);
}

function tail(text: string, lines = 25): string {
  return text.trim().split(/\r?\n/).slice(-lines).join("\n");
}

/**
 * pnpm without a shell: when the suite was started through pnpm, `npm_execpath` is pnpm's own JS entry point, so it
 * is run with the current Node (no `.cmd` shim, no shell). Falls back to a shell only if that variable is absent.
 */
function pnpmCommand(args: string[]): { command: string; args: string[]; shell: boolean } {
  const entry = process.env["npm_execpath"];
  if (entry !== undefined && /pnpm[^/\\]*\.c?js$/.test(entry)) return { command: process.execPath, args: [entry, ...args], shell: false };
  return { command: "pnpm", args, shell: isWindows };
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, cwd = repoRoot): string {
  const target = command === "pnpm" ? pnpmCommand(args) : { command, args, shell: false };
  const result = spawnSync(target.command, target.args, { cwd, env, encoding: "utf8", shell: target.shell, windowsHide: true });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`\`${command} ${args.join(" ")}\` failed (exit ${result.status ?? "signal"}):\n${tail(output)}`);
  }
  return output;
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function assertPortsFree(): Promise<void> {
  for (const [label, port] of [
    ["PostgreSQL", E2E_PG_PORT],
    ["API", E2E_API_PORT],
    ["web", E2E_WEB_PORT],
  ] as const) {
    if (await isPortInUse(port)) {
      throw new Error(
        `Port ${port} (${label}) is already in use. The E2E stack never reuses a running service: stop whatever holds it (a previous interrupted E2E run?) or set E2E_${label === "PostgreSQL" ? "PG" : label.toUpperCase()}_PORT.`,
      );
    }
  }
}

async function waitFor(description: string, check: () => Promise<boolean> | boolean, timeoutMs: number, intervalMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      // not ready yet
    }
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${description}.`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (isWindows) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  else child.kill("SIGTERM");
}

export interface StackHandle {
  /** Password of the four demo accounts (random, per run). */
  readonly demoPassword: string;
  stop(): Promise<void>;
}

export async function startStack(): Promise<StackHandle> {
  assertNotDeveloperStack();
  await assertPortsFree();
  // The E2E Vite config imports the application's own config with extensionless specifiers; this only silences a notice.
  process.env["VITE_CONFIG_NATIVE_IGNORE_WARNING"] = "true";

  const pgPassword = randomBytes(18).toString("base64url");
  // 12+ characters, more than 4 distinct ones, not on the common list: satisfies the password policy of the seed.
  const demoPassword = `${randomBytes(9).toString("base64url")}-Aa1`;
  const databaseUrl = `postgresql://postgres:${pgPassword}@127.0.0.1:${E2E_PG_PORT}/${DB_NAME}`;

  const stopSteps: Array<() => Promise<void> | void> = [];
  const stop = async () => {
    for (const step of stopSteps.reverse()) {
      try {
        await step();
      } catch (error) {
        log(`teardown step failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    stopSteps.length = 0;
  };

  try {
    // 1. PostgreSQL. A leftover container of THIS name (an interrupted earlier run) is removed first; no other container is touched.
    spawnSync("docker", ["rm", "-f", E2E_PG_CONTAINER], { windowsHide: true, encoding: "utf8" });
    log(`starting ${E2E_PG_CONTAINER} (postgres:17, 127.0.0.1:${E2E_PG_PORT})`);
    run("docker", [
      "run", "-d", "--rm",
      "--name", E2E_PG_CONTAINER,
      "-e", `POSTGRES_PASSWORD=${pgPassword}`,
      "-e", `POSTGRES_DB=${DB_NAME}`,
      "-p", `127.0.0.1:${E2E_PG_PORT}:5432`,
      "postgres:17",
    ], process.env);
    stopSteps.push(() => {
      spawnSync("docker", ["rm", "-f", E2E_PG_CONTAINER], { windowsHide: true, encoding: "utf8" });
    });
    // A query over TCP inside the container: the image's temporary init server only listens on the unix socket.
    await waitFor(
      "PostgreSQL",
      () =>
        spawnSync("docker", ["exec", E2E_PG_CONTAINER, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", DB_NAME, "-tAc", "select 1"], {
          windowsHide: true,
          encoding: "utf8",
        }).status === 0,
      60_000,
      500,
    );

    // 2. Schema, queues, demo seed and one mirror synchronization (fake gateway) through the repository's real scripts.
    const commonEnv = {
      NODE_ENV: "development",
      DATABASE_URL: databaseUrl,
      AUTH_MODE: "dev",
      ALLOW_DEV_AUTH: "1",
      SANKHYA_MODE: "fake",
      LOG_LEVEL: "warn",
    };
    log("db:migrate");
    run("pnpm", ["db:migrate"], cleanEnv(commonEnv));
    log("db:queue:install");
    run("pnpm", ["db:queue:install"], cleanEnv(commonEnv));
    log("db:seed");
    run("pnpm", ["db:seed"], cleanEnv({ ...commonEnv, SEED_DEV_PASSWORD: demoPassword }));
    log("sync:once (fake gateway)");
    run("pnpm", ["--filter", "@salesforce/server", "run", "sync:once"], cleanEnv(commonEnv));

    // 3. API process (own port; the Vite origin is the only allowed origin).
    log(`starting API on ${E2E_API_ORIGIN}`);
    let apiOutput = "";
    const api = spawn(process.execPath, ["--import", "tsx", "src/main-api.ts"], {
      cwd: serverRoot,
      env: cleanEnv({
        ...commonEnv,
        API_HOST: "127.0.0.1",
        API_PORT: String(E2E_API_PORT),
        ALLOWED_ORIGINS: E2E_WEB_ORIGIN,
        // Non-secret dataset identity of this throwaway installation: the order editor refuses to write without it.
        SF_ERP_ENVIRONMENT: "e2e",
        SF_DATASET_ID: "e2e-fake-gateway-1",
      }),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    api.stdout?.on("data", (chunk: Buffer) => (apiOutput = tail(apiOutput + chunk.toString())));
    api.stderr?.on("data", (chunk: Buffer) => (apiOutput = tail(apiOutput + chunk.toString())));
    stopSteps.push(() => killTree(api));
    await waitFor(
      "the API to answer /api/v1/ready",
      async () => {
        if (api.exitCode !== null) throw new Error(`the API exited with code ${api.exitCode}:\n${apiOutput}`);
        const response = await fetch(`${E2E_API_ORIGIN}/api/v1/ready`);
        return response.status === 200;
      },
      60_000,
    ).catch((error: unknown) => {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nAPI output:\n${apiOutput}`);
    });

    // 4. Vite dev server with the application's own configuration (ports and proxy target changed only).
    log(`starting Vite on ${E2E_WEB_ORIGIN}`);
    const vite: ViteDevServer = await createServer({
      root: webRoot,
      configFile: path.join(webRoot, "e2e/vite.e2e.config.ts"),
      logLevel: "warn",
      clearScreen: false,
    });
    stopSteps.push(() => vite.close());
    await vite.listen();
    // Pre-transform the entry so the first test does not race dependency optimization.
    await vite.warmupRequest("/src/main.tsx");
    await waitFor("the web app", async () => (await fetch(`${E2E_WEB_ORIGIN}/`)).status === 200, 30_000);

    log("stack ready");
    return { demoPassword, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
