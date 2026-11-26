/**
 * Installation id: a random value the app keeps in the platform secure store and sends at login so the server can recognize the
 * installation (AUTH-2, PROPOSED). It identifies an installation, not a person or a hardware serial; a wipe regenerates it.
 */
export interface InstallIdStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}

export interface InstallIdStore {
  getOrCreate(): Promise<string>;
  /** After a wipe: the next login registers as a new installation. */
  reset(): Promise<void>;
}

/** Same shape the server accepts (`DeviceRegistrationSchema`). */
const INSTALL_ID = /^[A-Za-z0-9-]{8,64}$/;

export function createInstallIdStore(storage: InstallIdStorage, newId: () => string): InstallIdStore {
  return {
    async getOrCreate() {
      const existing = await storage.read();
      if (existing !== null && INSTALL_ID.test(existing)) return existing;
      const created = newId();
      if (!INSTALL_ID.test(created)) throw new Error("O gerador de identificadores devolveu um valor inválido.");
      await storage.write(created);
      return created;
    },
    reset: () => storage.remove(),
  };
}
