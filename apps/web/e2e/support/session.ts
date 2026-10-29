import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { E2E_PG_CONTAINER } from "./env";

/**
 * Session fixture (AUTH-6 option c, TEST-1): an operational seller never has a local password and the real sign-in goes
 * through the Sankhya verifier, which the throwaway stack does not have (AUTH-5: no fake verifier, no demo bypass). So a
 * seller session is opened the way a completed Sankhya sign-in would leave the database: the account gets a directory user
 * id (a seller session is valid only for a directory-linked account) and one live session row holding only the SHA-256
 * of a random token, which the browser then carries as the normal HttpOnly cookie.
 *
 * It writes to the throwaway database of THIS suite only (docker exec into the container the stack started, whose name is
 * fixed by env.ts), exposes no HTTP endpoint and is part of the test code, never of the application.
 */

const SESSION_HOURS = 8;

function uuidv7(): string {
  const bytes = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i += 1) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function psql(sql: string): string {
  const result = spawnSync("docker", ["exec", E2E_PG_CONTAINER, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", "salesforce_e2e", "-v", "ON_ERROR_STOP=1", "-tAc", sql], {
    windowsHide: true,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`session fixture: psql failed:\n${(result.stderr ?? "").trim().split(/\r?\n/).slice(-5).join("\n")}`);
  return (result.stdout ?? "").trim();
}

/** Only fixed, test-owned login names and numeric ids are interpolated; anything else is refused. */
function assertSafe(value: string, pattern: RegExp, what: string): void {
  if (!pattern.test(value)) throw new Error(`session fixture: unsafe ${what}.`);
}

/** Opens a live session for an existing active seller account and returns the plain cookie token. */
export function openSellerSession(loginName: string, directoryUserId: string): string {
  assertSafe(loginName, /^[a-z0-9._@-]+$/, "login name");
  assertSafe(directoryUserId, /^[0-9]{1,9}$/, "directory user id");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const linked = psql(
    `update account set external_user_id = '${directoryUserId}' where lower(email) = '${loginName}' and role = 'seller' and status = 'active' and (external_user_id is null or external_user_id = '${directoryUserId}') returning id`,
  );
  if (linked === "") throw new Error(`session fixture: no active seller account '${loginName}' (or it already carries another directory id).`);
  psql(
    `insert into session (id, account_id, token_hash, created_at, last_seen_at, expires_at) values ('${uuidv7()}', '${linked.split(/\s/)[0] ?? ""}', '${tokenHash}', now(), now(), now() + interval '${SESSION_HOURS} hours')`,
  );
  return token;
}
