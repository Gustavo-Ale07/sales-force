/**
 * AUTH-1/AUTH-2 (PROPOSED): the server answers 401 `device_revoked` to every request of a revoked installation. The API layer reports it
 * here once; the shell listens, deletes the local database and returns to the sign-in. A plain module-level channel because the signal
 * can come from any request (sync, reads, writes) and must reach the single owner of the session.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function onDeviceRevoked(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyDeviceRevoked(): void {
  for (const listener of [...listeners]) listener();
}
