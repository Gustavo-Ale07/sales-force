# Implementation status — Phase 0 / Slice 1 checkpoint (2026-09-18)

Branch `feat/phase-0-foundation`. Not merged to `main`. Brief: `slice-1.md`. Sankhya-side contract (PROPOSED): `sankhya-configuration-contract.md`.

## Done and verified (typecheck, lint, tests, build all exit 0 on 2026-09-18)

| Package | State | Tests |
|---|---|---|
| `packages/config` | tsconfig presets | – |
| `packages/domain` | pure rules, no infra deps | 188 |
| `packages/db` | Drizzle schema, migration `0000_initial_schema.sql`, one-shot advisory-locked runner; applied to the local dev DB (16 public tables incl. `schema_migration`) | 31 |
| `packages/contracts` | Zod 4 contracts, route registry, OpenAPI 3.1 + generated types committed (V-02 approach) | 59 |
| `packages/sankhya` | `SankhyaGateway`, fake gateway (synthetic fixtures), real read client (mock-HTTP tested only), error taxonomy. `submitOrder` and `readConfiguration` (live) throw `NotImplementedError` | 139 |
| `packages/ui` | design-system components | 21 |
| `apps/web` | Vite + React shell, dev-safe login screen, `/_design`, placeholder routes (`routes/pages.tsx`) | 27 |

## Not started / not done

- `apps/server` (API + worker), mirror sync job, `pnpm db:seed`, real `AuthClient` wiring.
- Web data pages (dashboard, customers, customer detail, catalog, new order, orders/drafts) exist only as placeholders; no data wiring.
- `deploy/docker-compose.yml`, nginx, scripts, `deploy/.env.example`, second-company how-to.
- `packages/sankhya`: no mapping unit tests, no sanitized HTTP fixtures; wire format is docs-level (see `sankhya-spike.md` §9.42, NEEDS VALIDATION).
- QA, security-reviewer (§15 trigger: auth, contracts, workspace) and code-reviewer passes are outstanding.
- Docs to update: V-02 choice and V-01 turbo note in `decisions.md`; roadmap status note (owner extended the slice beyond roadmap §3.2); architecture status of `packages/*`.
- ERP submission is disabled by design (SNK-5/SNK-6); the origin-id field is not defined.

## Visual checkpoint

**Not reached.** Only the login screen, `/_design` and the mobile drawer were browser-verified, and only against the scaffold. No data page has been seen in a browser.

## Known environment notes

- The Turborepo native binary crashes on this machine (0xC0000135); root scripts use `pnpm -r`, `turbo:*` variants remain for CI.
- TypeScript: 6.0.3 everywhere except `packages/db` (~5.9.3), to be standardised. ESLint 9 in web/ui (jsx-a11y peer range).

## Next task

`apps/server` → API → worker/sync → web data wiring → visual checkpoint.

## Resume

```
docker compose -f deploy/docker-compose.dev.yml up -d
pnpm install
# with DATABASE_URL from .env.example exported in the shell:
pnpm --filter @salesforce/db run migrate
pnpm -r --if-present run typecheck
pnpm --filter @salesforce/web run dev
```
