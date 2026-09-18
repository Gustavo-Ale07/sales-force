# @salesforce/contracts

Zod schemas are the source of truth for every HTTP request and response (STACK-4). The OpenAPI 3.1
document and the typed client are generated from them; nothing here is hand-maintained twice.

```
Zod schemas (src/*.ts)  ->  route registry (src/routes.ts)  ->  openapi/openapi.json  ->  src/generated/api-types.ts
                                     |                                                          |
                                     +-> server validation (later)                              +-> createApiClient (src/client.ts)
```

## V-02 decision (proposed for recording in `docs/decisions.md`)

| Concern          | Choice                                                                                                           | Why                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zod to OpenAPI   | Zod 4 native `z.toJSONSchema` (draft 2020-12, the OpenAPI 3.1 dialect) with a local registry for component names | No extra library to maintain or to lag behind Zod; `io: 'input'` for requests and `'output'` for responses; a small pure function rewrites `$defs` to `components/schemas` |
| Client generator | `openapi-typescript` (types) + `openapi-fetch` (runtime, about 6 kB)                                             | Types only come from the document, so no generated runtime code to review; browser-safe; works from Vite and React Native                                                  |
| Route source     | Own route registry (method, path, schemas, operationId, tags, auth, error statuses)                              | One list consumed by the OpenAPI generator and, later, by the server, so the two cannot drift                                                                              |

Alternatives considered: `@asteasolutions/zod-to-openapi` and `zod-openapi` (extra dependency layer over
something Zod now does natively); `orval` / `openapi-generator` (heavier, generate runtime code).
Revisit when the mobile client (MOB-1) or the sync messages need something the current pair cannot express.

## Entries

- `@salesforce/contracts`: schemas, inferred types, `routes`, `routeList`, `buildOpenApiDocument`, `serializeOpenApi`,
  error codes (`ERROR_CODES`, `ERROR_HTTP_STATUS`). Browser-safe: no Node built-ins, no `openapi-fetch`.
- `@salesforce/contracts/client`: `createApiClient(baseUrl, options?)`, an `openapi-fetch` client typed by the generated paths.
- `@salesforce/contracts/openapi.json`: the committed OpenAPI document.

## Commands

| Command                                                                         | Effect                                                                              |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm --filter @salesforce/contracts run openapi`                               | Regenerates `openapi/openapi.json` and `src/generated/api-types.ts` (deterministic) |
| `pnpm --filter @salesforce/contracts run openapi:check`                         | Fails when either generated file is stale                                           |
| `pnpm --filter @salesforce/contracts run test` / `lint` / `typecheck` / `build` | Usual checks                                                                        |

Generated files are committed. After changing a schema or the registry, run `openapi` and commit the result;
a test also fails when they are stale.

## Rules encoded here

- No cost or margin field, no secret, token or password field, except the login request `password` (P-20, P-22). Guarded by `test/guards.test.ts`.
- Decimals (quantities, unit prices, totals) are strings (DATA-3). Order create/replace bodies carry `productCode` and `quantity` only; a client-sent price is rejected (strict objects, P-09).
- Missing price is a state (`listPrice.state` = `none`), never `0`.
- Errors are `{ code, message, details? }` with an enumerated `code`.
- The installation configuration schema mirrors `InstallationConfiguration` in `@salesforce/domain` (compile-time equality) and calls the domain consistency validator; it rejects unknown keys except inside `features`. The client-safe `ConfigurationSummary` omits account e-mail links.
- Domain is imported as types, except the one validator call. No Node, NestJS, Drizzle or Sankhya imports (`test/boundaries.test.ts`).
