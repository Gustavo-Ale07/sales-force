# Mobile plan (apps/mobile, packages/mobile-db)

Owner: mobile-engineer. Written 2026-09-24. Code lives in the worktree `C:\Dev\sales-force-evolution`, branch
`feat/sales-force-evolution` (3 local commits, not pushed: `90e7c23`, `67b5567`, `beb251d`).
This file is a working note, not a decision. Status of every item follows `docs/decisions.md`.

## 1. Built in the first increment (WP 0.2 shell, online only)

- `apps/mobile` (`@salesforce/mobile`): Expo SDK 57 development build (`expo-dev-client`, no Expo Go), strict TS,
  PLAC identity, pt-BR. Metro uses Expo's default monorepo config; it works with pnpm workspaces as is.
  `expo export` for Android and iOS bundles all workspace packages (732 modules, 2.3 MB Hermes bytecode).
- Depends only on `@salesforce/contracts`, `@salesforce/domain`, `@salesforce/mobile-db` (architecture 4.2).
- `packages/mobile-db`: STUB. `getLocalStorageStatus()` always says "unavailable". No SQLite/SQLCipher library.
- Ports and adapters: `AuthPort`, `CustomerRepository`, `ProductRepository`, `ConnectivityPort`
  (`src/dependencies.ts` composes them). Online adapters over the generated openapi-fetch client. A future
  encrypted-local-DB adapter plugs into the same repository ports.
- Screens: login (validation via the contract Zod schema, server outcome shown), customers list, product
  catalog (list price via the server; missing price shows "Sem preço", never zero), online/offline badge and an
  honest offline notice ("this version keeps no data on the device").
- Interim transport: cookie session (`credentials: "include"`, native cookie jar). App code never reads,
  stores or logs a token. Documented in `src/data/api.ts`. NOT verified on a device.
- Tests: jest-expo (jest 29.7) + `@testing-library/react-native` 14 (with `test-renderer`): 71 tests in 10 suites
  (pure logic, adapters with a scripted `fetch`, hook, LoginScreen, Shell incl. 401 and offline states).
- Not done on purpose: no outbox, no sync, no offline orders, no discounts, no price logic, no cost/margin.

Scripts (`apps/mobile`): `start`, `typecheck`, `lint`, `test`, `bundle:check`. Root `pnpm -r` picks them up.
No `build` script (native builds are EAS, not part of this increment). No CI workflow exists in the repo yet.
`turbo` cannot execute on this Windows machine (missing DLL in the turbo binary, also for existing packages).

## 2. Auth survey (no server change made)

- Web auth: opaque server session in cookie `sf_session` (HttpOnly, SameSite=Lax, Path=/api/v1), plus a CSRF
  Origin / Sec-Fetch-Site check on mutating requests (`apps/server/src/iam/csrf.ts`, `cookies.ts`).
- The channel is hardcoded `web` in login and in the access guard. Round 4 (AUTH-1/2/3) is PROPOSED:
  security-model 3.2 / 4.1 / 8 require, for mobile, access/refresh tokens in the secure store and device approval.
- A React Native client can technically reuse the cookie session as is: the CSRF check passes when neither
  Origin nor Sec-Fetch-Site is sent (native clients send neither), and the native cookie jar keeps the cookie.
  Consequences: works only for a `web`-channel account; no device approval; no secure-store token; wipe on
  revocation and max-offline lock cannot be implemented on top of it. It is therefore an interim dev transport
  only, not the mobile authentication design.
- Options for Round 4 (for the architect/owner): (a) bearer access + rotating refresh token issued on a `mobile`
  channel with device binding, tokens in the secure store (matches security-model); (b) keep the cookie for
  mobile with a `mobile` channel and device approval (simpler, but conflicts with the token/secure-store text).
  Nothing implemented; needs the Round 4 decision first.

## 3. Blocked increments

| Increment | Blocked by |
|---|---|
| Mobile auth (token/refresh, device approval, secure store, wipe on revocation) | Round 4: AUTH-1, AUTH-2, AUTH-3 (PROPOSED) |
| Encrypted local database, local schema and migrations | V-09 / spike S7 (MOB-2 approved in direction; library NEEDS VALIDATION); do not pick a library early |
| Pull, bundles, scope events, outbox, push, offline orders, `revisao_preco` | Round 5 (SYNC-x, PROPOSED), R05-R11, R16, R45 UNDECIDED; interim rule sync-protocol section 9 |
| Max-offline lock, offline data wipe | R16 (UNDECIDED) and Round 4 |
| OTA update channels, EAS profiles | R10/R11 (UNDECIDED) |
| Store distribution builds (real bundle id, signing) | T2 (Apple/Google org accounts, D-U-N-S), MOB-3 / V-10; U-08 store review demo environment (deferred to the Phase 1 gate) |
| iOS device verification | Needs macOS or an EAS build; platform coverage for Maestro UNDECIDED (R48) |

## 4. Proposed order of next increments

1. Owner runs a dev build on a real Android device and confirms the cookie transport against a dev API
   (LAN/HTTPS URL in `EXPO_PUBLIC_API_URL`); then EAS `development` profile (no OTA rules needed).
2. Spike S7 (encrypted SQLite candidates, key in secure store, wipe, performance) in a throwaway workspace;
   findings back to the owner before any library enters `packages/mobile-db`.
3. After Round 4 is approved: mobile auth adapter replacing the cookie transport (behind `AuthPort`), device
   approval screens, secure storage, revocation wipe.
4. After S7 and Round 5: local schema (with database-engineer), pull/bundle application, scope-event cleanup,
   then outbox + push, then offline order draft, price review states, sync indicators.
5. Maestro flows for login/list once a device or emulator pipeline exists (R48).

## 5. Dependencies added (apps/mobile)

`expo` (pinned 57.0.24; 57.0.25 was under the pnpm one-day supply-chain window), `expo-dev-client`, `expo-network`,
`react`, `react-native`, `react-native-safe-area-context` (runtime); `jest`, `jest-expo`, `@react-native/jest-preset`,
`@testing-library/react-native`, `test-renderer`, `@types/jest`, `@types/react`, `eslint` stack (dev). All are
MIT-licensed, actively maintained Expo/Meta/Testing Library packages. No storage, crypto or SQLite package.
