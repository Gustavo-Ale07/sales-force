import type { DbHandle } from '@salesforce/db';
import type { PasswordHashParams } from '../config/auth-env.js';
import { AccountRepository } from '../iam/account.repository.js';
import { AccountService } from '../iam/account.service.js';
import { AuditService } from '../iam/audit.service.js';
import { Argon2idPasswordHasher } from '../iam/password-hasher.js';
import { SessionRepository } from '../iam/session.repository.js';
import { ThrottleRepository } from '../iam/throttle.repository.js';
import { systemClock, type Clock } from '../platform/tokens.js';

/**
 * Wires the account services without the Nest container, for the operator scripts (seed and the
 * account CLI). Same classes, same audit trail as the API process.
 */
export function createOperatorAccountService(
  handle: DbHandle,
  hash: PasswordHashParams,
  clock: Clock = systemClock,
): { accounts: AccountService; repository: AccountRepository } {
  const repository = new AccountRepository(handle.db);
  const service = new AccountService(
    handle.db,
    new Argon2idPasswordHasher(hash),
    repository,
    new SessionRepository(handle.db),
    new ThrottleRepository(handle.db),
    new AuditService(handle.db, clock),
    clock,
  );
  return { accounts: service, repository };
}
