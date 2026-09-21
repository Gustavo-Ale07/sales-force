import { routes, toColonPath, type RouteDefinition } from '@salesforce/contracts';
import { ACCOUNT_ROLES, type AccountRole } from '@salesforce/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROUTE_POLICY } from '../../src/iam/policy.js';
import { TEST_ORIGIN, TEST_PASSWORD, createTestAccount } from '../helpers/auth.js';
import { loginCookie, startAuthApp, type AuthApp } from '../helpers/auth-app.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * Authorization matrix (role x route). Every `session` route of the contract registry needs a row
 * here: a route added to the registry without one fails this suite, so no endpoint can ship without
 * an explicit allow/deny decision per role. `allow` means "the guard lets the role through"; the
 * handler behind it may answer anything except 401/403 (e.g. 409 when the installation is not enabled).
 *
 * Deny-by-default (security-model 5.1 is PROPOSED): a role not listed for an operation is denied.
 * Which ROWS an allowed role sees is data scope, not route access: see the IDOR suite
 * (`commercial-scope.test.ts`).
 */
type Expectation = 'allow' | 'deny';
const MATRIX: Readonly<Record<string, Readonly<Record<AccountRole, Expectation>>>> = {
  logout: { admin: 'allow', manager: 'allow', seller: 'allow' },
  getConfiguration: { admin: 'allow', manager: 'deny', seller: 'deny' },
  // Commercial routes (Stage 3A). The three roles that exist may use them; the external
  // representative role does not exist yet (AUTH-3 PROPOSED) and gets no grant until the owner decides.
  getDashboard: { admin: 'allow', manager: 'allow', seller: 'allow' },
  listSellers: { admin: 'allow', manager: 'allow', seller: 'allow' },
  listCustomers: { admin: 'allow', manager: 'allow', seller: 'allow' },
  getCustomer: { admin: 'allow', manager: 'allow', seller: 'allow' },
  listProductGroups: { admin: 'allow', manager: 'allow', seller: 'allow' },
  listProducts: { admin: 'allow', manager: 'allow', seller: 'allow' },
  getProduct: { admin: 'allow', manager: 'allow', seller: 'allow' },
  listOrders: { admin: 'allow', manager: 'allow', seller: 'allow' },
  createOrder: { admin: 'allow', manager: 'allow', seller: 'allow' },
  getOrder: { admin: 'allow', manager: 'allow', seller: 'allow' },
  replaceOrder: { admin: 'allow', manager: 'allow', seller: 'allow' },
  discardOrder: { admin: 'allow', manager: 'allow', seller: 'allow' },
  submitOrder: { admin: 'allow', manager: 'allow', seller: 'allow' },
};

const sessionRoutes = (Object.values(routes) as RouteDefinition[]).filter((route) => route.auth === 'session');

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: AuthApp;
const cookies = {} as Record<AccountRole, string>;

beforeAll(async () => {
  postgres = await startPostgres();
  // Every session route of the registry has a real handler now: no stubs. The real guard and policy
  // decide, then the real handler runs (an empty installation answers 409, never 401/403).
  ctx = await startAuthApp(postgres, opened);
  for (const role of ACCOUNT_ROLES) {
    await createTestAccount(ctx.database.handle, { email: `${role}@example.test`, role }, ctx.clock.fn);
    cookies[role] = await loginCookie(ctx, `${role}@example.test`, TEST_PASSWORD);
  }
});

afterAll(async () => {
  for (const close of opened.reverse()) await close();
  await postgres.stop();
});

/** A concrete URL for a route: path parameters replaced by a well-formed UUID. */
function urlOf(route: RouteDefinition): string {
  return `/api/v1${toColonPath(route).replace(/:\w+/g, '019a0000-0000-7000-8000-000000000000')}`;
}

function callOf(route: RouteDefinition, cookie: string | undefined) {
  return ctx.app.inject({
    method: route.method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: urlOf(route),
    headers: { origin: TEST_ORIGIN, 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
    payload: route.method === 'get' ? undefined : '{}',
  });
}

describe('authorization matrix', () => {
  it('has a row for every session route of the registry, and none for a route that does not exist', () => {
    expect(Object.keys(MATRIX).sort()).toEqual(sessionRoutes.map((route) => route.operationId).sort());
  });

  it('keeps the policy table and the matrix in agreement (a grant needs a matrix row)', () => {
    for (const operationId of Object.keys(ROUTE_POLICY)) expect(MATRIX, operationId).toHaveProperty(operationId);
    for (const [operationId, row] of Object.entries(MATRIX)) {
      for (const role of ACCOUNT_ROLES) {
        const granted = ROUTE_POLICY[operationId]?.roles.includes(role) ?? false;
        expect(granted, `${operationId} / ${role}`).toBe(row[role] === 'allow');
      }
    }
  });

  for (const route of sessionRoutes) {
    describe(`${route.method.toUpperCase()} ${route.path} (${route.operationId})`, () => {
      it('is 401 without a session', async () => {
        expect((await callOf(route, undefined)).statusCode).toBe(401);
      });

      for (const role of ACCOUNT_ROLES) {
        const expected = MATRIX[route.operationId]?.[role] ?? 'deny';
        it(`${expected === 'allow' ? 'lets in' : 'denies'} ${role}`, async () => {
          // Logout ends the session it is called with: it gets its own.
          const cookie = route.operationId === 'logout' ? await loginCookie(ctx, `${role}@example.test`, TEST_PASSWORD) : cookies[role];
          const response = await callOf(route, cookie);
          if (expected === 'deny') {
            expect(response.statusCode).toBe(403);
          } else {
            // Past the guard: whatever the handler answers, it is not an authentication or authorization failure.
            expect([401, 403]).not.toContain(response.statusCode);
          }
        });
      }
    });
  }
});
