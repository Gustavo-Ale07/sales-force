import { startStack } from "./support/stack";

/**
 * Starts the throwaway stack once per run and hands the generated demo password to the test workers through the
 * environment (workers are forked after this returns). The returned function stops exactly what was started.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const stack = await startStack();
  process.env["E2E_DEMO_PASSWORD"] = stack.demoPassword;
  return () => stack.stop();
}
