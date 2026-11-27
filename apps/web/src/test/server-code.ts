import { SERVER_CODE_PREFIX } from "../lib/server-code";

/** A well-formed synthetic server code (never a real key): "sf1." + base64url({ a, k }) with a 32-byte key. */
export function makeServerCode(key = "A".repeat(43), api = "http://localhost"): string {
  const json = JSON.stringify({ a: api, k: key });
  const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return `${SERVER_CODE_PREFIX}${base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export const TEST_SERVER_CODE = makeServerCode();
export const TEST_SERVER_KEY = "A".repeat(43);
