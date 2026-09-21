import { parseArgs } from 'node:util';
import { createDb } from '@salesforce/db';
import { ACCOUNT_ROLES, type AccountRole } from '@salesforce/domain';
import { z } from 'zod';
import { createOperatorAccountService } from './cli/operator.js';
import { passwordHashFields, passwordHashParamsOf, passwordHashProblems } from './config/auth-env.js';
import { databaseUrlField, isLoopbackDatabaseUrl, nodeEnvField, parseEnv } from './config/env.js';
import { AccountAlreadyExistsError, AccountNotFoundError, PasswordPolicyError } from './iam/account.service.js';
import { runMain } from './process.js';

/**
 * Operator account CLI (RF-IAM-1; no user-administration endpoint exists in Phase 0):
 *
 *   pnpm --filter @salesforce/server account create --email a@b.c --name "Nome" --role admin
 *   pnpm --filter @salesforce/server account set-password --email a@b.c
 *   pnpm --filter @salesforce/server account unlock --email a@b.c
 *
 * The password is read from `ACCOUNT_PASSWORD`, or from standard input with `--password-stdin`
 * (first line). It is never a command-line argument (process lists and shell history keep those),
 * never echoed and never audited; the password policy is enforced. Guards: `NODE_ENV` is required
 * (no default); the database must be loopback unless the operator states `ALLOW_REMOTE_DB=1` for a
 * deliberate action on a shared database (first administrator of an installation).
 */
const CliEnvSchema = z.object({
  NODE_ENV: nodeEnvField,
  DATABASE_URL: databaseUrlField,
  ACCOUNT_PASSWORD: z.string().optional(),
  ALLOW_REMOTE_DB: z.string().optional(),
  ...passwordHashFields,
});

async function readFirstStdinLine(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const text = Buffer.concat(chunks).toString('utf8');
  const [first = ''] = text.split(/\r?\n/);
  return first;
}

function fail(message: string): never {
  throw new Error(message);
}

runMain('account-cli', async () => {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string' },
      'password-stdin': { type: 'boolean', default: false },
    },
  });
  const [command] = positionals;
  if (command !== 'create' && command !== 'set-password' && command !== 'unlock') {
    fail('usage: account <create|set-password|unlock> --email <address> [--name <display name>] [--role admin|manager|seller] [--password-stdin]');
  }
  const email = values.email ?? fail('--email is required');
  if (!z.email().max(254).safeParse(email).success) fail('--email is not a valid e-mail address');

  const env = parseEnv('account-cli', CliEnvSchema, process.env, (parsed) => {
    const problems = passwordHashProblems(parsed);
    if (!isLoopbackDatabaseUrl(parsed.DATABASE_URL.reveal()) && parsed.ALLOW_REMOTE_DB !== '1') {
      problems.push('DATABASE_URL: the host is not loopback; set ALLOW_REMOTE_DB=1 to act deliberately on a shared database.');
    }
    return problems;
  });

  let password = '';
  if (command !== 'unlock') {
    password = values['password-stdin'] ? await readFirstStdinLine() : (env.ACCOUNT_PASSWORD ?? '');
    if (password === '') fail('a password is required: set ACCOUNT_PASSWORD or pipe it in with --password-stdin');
  }

  const db = createDb(env.DATABASE_URL.reveal(), { max: 2, applicationName: 'salesforce-account-cli' });
  try {
    const { accounts, repository } = createOperatorAccountService(db, passwordHashParamsOf(env));
    try {
      if (command === 'create') {
        const role = values.role ?? fail('--role is required (admin, manager or seller)');
        if (!(ACCOUNT_ROLES as readonly string[]).includes(role)) fail('--role must be admin, manager or seller');
        const name = values.name ?? fail('--name is required');
        const id = await accounts.createAccount({ email, displayName: name, password, role: role as AccountRole });
        process.stdout.write(`account created: ${id} (${role})\n`);
      } else if (command === 'set-password') {
        const found = await repository.findByEmail(email);
        if (found === null) throw new AccountNotFoundError();
        await accounts.setPassword(found.id, password);
        process.stdout.write('password changed; every session of the account was ended\n');
      } else {
        const cleared = await accounts.unlock(email);
        process.stdout.write(cleared ? 'lockout cleared\n' : 'no lockout was recorded for this address\n');
      }
    } catch (error) {
      if (error instanceof PasswordPolicyError || error instanceof AccountAlreadyExistsError || error instanceof AccountNotFoundError) {
        // Actionable and secret-free: the policy text names rules, not the password.
        fail(error.message);
      }
      throw error;
    }
  } finally {
    await db.close();
  }
});
