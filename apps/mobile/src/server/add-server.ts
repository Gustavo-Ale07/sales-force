import { checkServerCode, connectionFromCode, type CodeCheck, type ServerCodeStore, type ServerConnection } from "./server-connection";

export const INVALID_CODE_MESSAGE = "Código inválido";

export interface AddServerDeps {
  readonly store: ServerCodeStore;
  readonly check?: (raw: string) => Promise<CodeCheck>;
}

/**
 * "Adicionar servidor": the server must accept the code before it is kept. The accepted code goes to the secure store and the
 * app moves on to the sign-in; anything else returns `null` (the screen shows only "Código inválido").
 */
export async function addServer(raw: string, deps: AddServerDeps): Promise<ServerConnection | null> {
  const result = await (deps.check ?? checkServerCode)(raw);
  if (!result.ok) return null;
  await deps.store.set(raw.trim());
  return result.connection;
}

export type StoredServer = { readonly kind: "none" } | { readonly kind: "ready"; readonly connection: ServerConnection };

/** The code kept on the device. A stored value that no longer reads as a code is dropped: the app starts at "Adicionar servidor". */
export async function loadStoredServer(store: ServerCodeStore): Promise<StoredServer> {
  const raw = await store.get().catch(() => null);
  if (raw === null) return { kind: "none" };
  const connection = connectionFromCode(raw);
  if (connection === null) {
    await store.clear().catch(() => undefined);
    return { kind: "none" };
  }
  return { kind: "ready", connection };
}
