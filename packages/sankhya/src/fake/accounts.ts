import type { AccountRole } from '@salesforce/domain';

/**
 * Dev/demo accounts for the server seeder (`pnpm db:seed`). Synthetic: the `.local` domain never
 * resolves. The seeder owns passwords and hashing; nothing secret lives here.
 */
export interface DemoAccount {
  readonly email: string;
  readonly displayName: string;
  readonly role: AccountRole;
}

export const DEMO_ACCOUNT_EMAILS = {
  admin: 'admin@demo.salesforce.local',
  manager: 'gerente@demo.salesforce.local',
  seller1: 'vendedor1@demo.salesforce.local',
  seller2: 'vendedor2@demo.salesforce.local',
} as const;

export const DEMO_ACCOUNTS: readonly DemoAccount[] = Object.freeze([
  Object.freeze({ email: DEMO_ACCOUNT_EMAILS.admin, displayName: 'Administrador Demo', role: 'admin' as const }),
  Object.freeze({ email: DEMO_ACCOUNT_EMAILS.manager, displayName: 'Gerente Demo', role: 'manager' as const }),
  Object.freeze({ email: DEMO_ACCOUNT_EMAILS.seller1, displayName: 'Vendedor Demo 1', role: 'seller' as const }),
  Object.freeze({ email: DEMO_ACCOUNT_EMAILS.seller2, displayName: 'Vendedor Demo 2', role: 'seller' as const }),
]);
