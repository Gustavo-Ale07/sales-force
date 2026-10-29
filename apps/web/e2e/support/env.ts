/**
 * Ports and names of the throwaway E2E stack. Every value has an environment override, but the defaults are
 * deliberately different from the developer stack (API 3000, worker 3001, Vite 5173, PostgreSQL 55432) so a
 * default run can never touch it. `assertNotDeveloperStack` enforces that even for overrides.
 */
function port(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be a port number.`);
  return value;
}

export const E2E_PG_PORT = port("E2E_PG_PORT", 55498);
export const E2E_API_PORT = port("E2E_API_PORT", 3100);
export const E2E_WEB_PORT = port("E2E_WEB_PORT", 5273);

export const E2E_WEB_ORIGIN = `http://127.0.0.1:${E2E_WEB_PORT}`;
export const E2E_API_ORIGIN = `http://127.0.0.1:${E2E_API_PORT}`;
export const E2E_PG_CONTAINER = `sf-e2e-postgres-${E2E_PG_PORT}`;

/** Ports that belong to the developer's live stack; the E2E stack refuses to use them. */
const DEVELOPER_STACK_PORTS: ReadonlyMap<number, string> = new Map([
  [3000, "API"],
  [3001, "worker health"],
  [5173, "Vite dev server"],
  [4173, "Vite preview"],
  [55432, "PostgreSQL"],
]);

export function assertNotDeveloperStack(): void {
  for (const [value, label] of [
    [E2E_PG_PORT, "E2E_PG_PORT"],
    [E2E_API_PORT, "E2E_API_PORT"],
    [E2E_WEB_PORT, "E2E_WEB_PORT"],
  ] as const) {
    const owner = DEVELOPER_STACK_PORTS.get(value);
    if (owner !== undefined) {
      throw new Error(`${label}=${value} is the developer stack's ${owner} port; the E2E stack must never use it.`);
    }
  }
}

/** Accounts of the synthetic demo installation (`packages/sankhya` fake accounts; `.local` never resolves). */
export const ACCOUNTS = {
  seller: "vendedor1@demo.salesforce.local",
  sellerName: "Vendedor Demo 1",
  seller2: "vendedor2@demo.salesforce.local",
  seller2Name: "Vendedor Demo 2",
  manager: "gerente@demo.salesforce.local",
  managerName: "Gerente Demo",
} as const;

/** Password of the demo accounts: generated per run by the global setup, never written to disk. */
export function demoPassword(): string {
  const value = process.env["E2E_DEMO_PASSWORD"];
  if (value === undefined || value === "") {
    throw new Error("E2E_DEMO_PASSWORD is not set: the global setup did not run (start the suite with `pnpm e2e`).");
  }
  return value;
}
