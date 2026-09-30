# Mobile Spike (S7) — Findings and Open Questions

**Responsibility of this file:** the record of what is **validated** about the encrypted local SQLite library candidates for `apps/mobile` / `packages/mobile-db`, which project decisions constrain the choice, and what still **needs validation** before V-09 can close and the Phase 1 gate item S7 can be marked done.

**Scope:** S7 only (`roadmap.md:120`: "Mobile local database and sync sizing"; `decisions.md` V-09: "SQLCipher library, Android 16 KB pages, FTS5, safe Drizzle compatibility with the encrypted library (conflict returns to the owner), performance"). This document does not select a library, does not implement `packages/mobile-db`, and does not touch `roadmap.md` or `decisions.md` — those are updated separately once the owner reviews these findings.

**Last updated:** 2026-09-28 (initial spike session — research + a type-level feasibility check; no native/on-device verification was possible in this environment).

---

## 0. Rules for this document

Mirrors `docs/sankhya-spike.md` §0.

1. Nothing about library behavior is assumed. A fact is recorded as VALIDATED only with evidence (official docs, changelog/release entry, GitHub issue/PR with a resolution, or an observation reproduced in this session).
2. Documentation-level evidence is weaker than a reproduced observation. Marked "VALIDATED (docs)"; environment/device evidence is marked "VALIDATED (env)" only when it came from something actually run in this session.
3. A GitHub issue being closed is not proof a fix shipped in the version this project would use — the shipped version must be checked separately (changelog entry or `npm` registry `time`/version).
4. Unknown items stay NEEDS VALIDATION and block V-09 / the S7 gate item.
5. This spike **never selects** the library. Per MOB-2 (`decisions.md`): "do not select or implement an unvalidated library before S7... if the selected encrypted SQLite implementation cannot work safely with Drizzle, the conflict returns to the owner." This document is input to that owner decision, not the decision itself.

### Status values

| Status | Meaning |
|---|---|
| VALIDATED (docs) | Stated in official library documentation or an official changelog entry with a version/date |
| VALIDATED (env) | Reproduced in this session (`apps/mobile`, this machine) with evidence below |
| NEEDS VALIDATION | Not yet validated — never presented as fact |
| NEEDS FURTHER VALIDATION | Partially validated; a real device / EAS build / production-volume test is still required |
| ARCHITECTURAL DECISION INPUT | A recommendation derived from validated findings, offered to the owner/architect; not itself an approved decision until recorded in `decisions.md` |

---

## 1. Project decisions and prior open items that constrain this spike

| Ref | Status | Topic | Detail |
|---|---|---|---|
| MOB-2 | APPROVED IN DIRECTION ONLY (library NEEDS VALIDATION, S7/V-09) | Offline encryption | Offline mobile data must be encrypted; unencrypted local storage rejected. Drizzle is the intended local data-access abstraction (DATA-2). No library selection/implementation before S7 concludes; a Drizzle/encryption conflict returns to the owner; encryption is never silently downgraded. |
| V-09 | NEEDS VALIDATION (this spike) | S7 scope | SQLCipher library, Android 16 KB pages, FTS5, safe Drizzle compatibility (conflict → owner), performance. |
| V-14 | NEEDS VALIDATION (Phase 1 gate, with S7) | Real data volumes | Portfolio size per representative, prices per customer, item history (R12) — feeds `SYNC-3` sizing and the spec §13 performance targets. |
| R44 (spec-review.md) | Recorded risk, not a decision | SQLCipher/Expo compatibility | Anticipated exactly this spike's risk before it was investigated: `useSQLCipher` needs a native build (no Expo Go); an "open report" of an Android 16 KB memory-page issue with SQLCipher that Google Play started requiring; FTS + Drizzle + performance all need validation. Names `op-sqlite` as plan B. |
| R45 (spec-review.md) | Recorded risk, not a decision | SQLCipher key loss | If secure storage holding the SQLCipher key is wiped (biometric change, device restore), the database becomes unreadable, including the outbox. Out of scope for this document (belongs to secure-storage/key-management work), noted here only because it bears on the encryption choice. |
| STACK-4 | APPROVED (Round 6) | ORM direction | Drizzle for PostgreSQL; "mobile SQLite only if safe with the encrypted library" — this spike is exactly that safety check. |
| P-07/P-08 | APPROVED | Offline-first | Every write is a local outbox command; server-side revalidation is authoritative — not directly tested here, but the local DB this spike investigates is where the outbox lives. |
| MOB-1 | APPROVED IN DIRECTION | Mobile toolchain | Expo development builds, never Expo Go — relevant because SQLCipher is documented as unsupported on Expo Go for both candidates (§2, §3). |

---

## 2. Candidate A — `expo-sqlite` + built-in SQLCipher support (Plan A per spec-review.md R44)

### 2.1 What was checked and how

Official docs fetched directly in this session (`https://docs.expo.dev/versions/latest/sdk/sqlite/`, current = SDK 57 as served 2026-09-28), the `expo-sqlite` CHANGELOG on the `sdk-57` branch of `github.com/expo/expo` (`packages/expo-sqlite/CHANGELOG.md`), the `npm` registry version/time history for `expo-sqlite`, and the specific GitHub issue that matches the R44 "open report" (`expo/expo#39792`) including its resolution thread and the merged fix PR (`expo/expo#40781`).

### 2.2 Findings

| ID | Fact | Status | Evidence |
|---|---|---|---|
| M-01 | `expo-sqlite`'s built-in config plugin exposes `useSQLCipher` (default `false`) as an `app.json`/`app.config` plugin option, requiring `npx expo prebuild` (native rebuild) to take effect. Official docs state: "SQLCipher is not supported on Expo Go." | VALIDATED (docs) | `docs.expo.dev/versions/latest/sdk/sqlite/` §"Configurable properties" and §"SQLCipher", fetched 2026-09-28 |
| M-02 | After opening the database, SQLCipher requires the app to run `PRAGMA key = 'password'` as the very first statement — this is the entire runtime API surface `expo-sqlite` exposes for encryption (no separate `encryptionKey` open-option). | VALIDATED (docs) | Same page, §"SQLCipher" code sample |
| M-03 | FTS5 (plus FTS3/FTS4) is enabled by default (`enableFTS: true`) via the same config plugin; the docs link directly to `sqlite.org/fts5.html`. | VALIDATED (docs) | Same page, config table |
| M-04 | Drizzle ORM has an official, documented integration with `expo-sqlite` ("Drizzle ORM" is one of two named "Third-party library integrations" on the `expo-sqlite` doc page, alongside Knex.js), and `drizzle-orm` ships a dedicated `drizzle-orm/expo-sqlite` driver/session/migrator (confirmed present in `drizzle-orm@0.45.2`, the exact version already pinned in `apps/server` and `packages/db` — see §4). The documented pattern is `const expo = openDatabaseSync("db.db"); const db = drizzle(expo);`. | VALIDATED (docs) | `docs.expo.dev` §"Drizzle ORM"; `orm.drizzle.team/docs/sqlite/connect-expo-sqlite` (fetched via redirect from `/docs/connect-expo-sqlite`); `npm` registry `exports` field of `drizzle-orm@0.45.2` |
| M-05 | Neither the `expo-sqlite` docs nor the Drizzle `connect-expo-sqlite` doc mentions SQLCipher together with Drizzle. **The combination (SQLCipher's mandatory first-statement `PRAGMA key` + Drizzle wrapping the same connection object) is not documented as a tested pairing by either project** — it is architecturally plausible (Drizzle only calls `execAsync`/`execSync` on whatever connection object it is given, so an already-keyed connection should work transparently) but this plausibility is **not the same as a validated pairing**. | NEEDS FURTHER VALIDATION | Absence of "cipher" in the fetched Drizzle expo-sqlite doc (0 matches); reasoning from the driver's documented shape, not from a reproduced encrypted query |
| M-06 | **The R44 "open report" of an Android 16 KB memory-page issue is a real, resolved bug, specific to `useSQLCipher`.** `expo/expo#39792` ("Android: Support 16 KB memory page size when enabling expo-sqlite useSQLCipher"), filed 2025-09-18 against `expo-sqlite@53.x`/Expo SDK 53: enabling `useSQLCipher` bundled a non-16-KB-aligned `libcrypto.so` (OpenSSL, via the `ndkports` build), which Google Play rejected starting 2025-11-01 (Play's enforcement date for Android 15+ targets). Root cause traced to the underlying `ndkports` OpenSSL package (`ronickg/ndkports#3`); fixed by `expo/expo#40781` ("Update OpenSSL dependency version in build.gradle"), merged 2025-11-03. | VALIDATED (docs) | GitHub REST API dump of issue `expo/expo#39792` (body, 10 comments) and PR `expo/expo#40781` (`merged: true`, `merged_at: 2025-11-03T20:01:45Z`, base `sdk-54`), fetched 2026-09-28 |
| M-07 | The fix shipped in `expo-sqlite@16.0.9` (2025-11-03), confirmed by the `sdk-57`-branch changelog line "Fixed Android 16kb page size issue when enabling `useSQLCipher`" under the `16.0.9` heading. A **separate, general** Android 16 KB page-size fix (not SQLCipher-specific) shipped earlier in `expo-sqlite@15.2.13` (2025-07-01, "Added Android 16KB page size support"). | VALIDATED (docs) | `raw.githubusercontent.com/expo/expo/sdk-57/packages/expo-sqlite/CHANGELOG.md`, fetched 2026-09-28, lines 153–163 and 224–228 |
| M-08 | The `expo-sqlite` version actually resolved by Expo SDK 57 (`apps/mobile`'s pinned `expo@57.0.24`) is `57.0.3` (npm dist-tag `sdk-57` / `latest`), released 2026-09-11 — many releases after the `16.0.9` fix (expo-sqlite's versioning scheme changed from independent `16.x`/`17.x` numbers to tracking the Expo SDK major number partway through 2026). **The 16 KB SQLCipher fix is therefore already included in the version this project would actually install.** | VALIDATED (docs) | `npm` registry `time`/`dist-tags` dump for `expo-sqlite`, fetched 2026-09-28 |

### 2.3 Feasibility prototype attempted (this session)

- Installed `expo-sqlite@57.0.3` and `drizzle-orm@0.45.2` into `apps/mobile` with `pnpm add` (exact `expo-sqlite` version Expo SDK 57 resolves; exact `drizzle-orm` version already pinned server-side in `apps/server`/`packages/db`, to avoid introducing a second ORM version into the monorepo).
- Wrote a throwaway file (never committed) at `apps/mobile/src/__spike-s7-scratch__/prototype.ts` that: opens a database with `openDatabaseSync`, runs `PRAGMA key = '<password>'` as the first statement (mirroring M-02), wraps the same connection with `drizzle(expo, { schema })` (mirroring M-04), defines one trivial `sqliteTable` with no cost/margin/business fields, and calls `db.insert(...)` / `db.select(...).all()`.
- Ran, in `apps/mobile`: `tsc -p tsconfig.json` (exit 0, no diagnostics), `eslint .` (exit 0, no diagnostics), `jest` (all 10 existing suites / 71 tests still passed, unaffected), and `expo export --platform android --output-dir dist --clear` (Metro bundled cleanly, 732 modules, produced a `.hbc` bundle with no resolution/bundling errors).
- **What this proves:** the two libraries' public TypeScript types compose without conflict, the JS/TS toolchain (tsc, eslint, Jest, Metro) has no problem with `expo-sqlite` + `drizzle-orm/expo-sqlite` in the dependency graph, and nothing in the existing `apps/mobile` code was broken by adding them.
- **What this does NOT prove:** it does not prove SQLCipher actually encrypts anything, that the `PRAGMA key` + Drizzle sequence works at runtime, that FTS5 works under SQLCipher, or anything about the 16 KB native alignment claim in M-06–M-08 for a build produced from this exact repo. None of that was run — there is no Android SDK, no Java/JDK, no emulator, and no EAS credentials configured in this session's environment (`ANDROID_HOME` unset, `java` not on `PATH`; confirmed by direct check). Running `expo prebuild` and a real native build was out of reach here.
- **Disposition of the experimental change:** reverted in full. `pnpm remove expo-sqlite drizzle-orm` in `apps/mobile`, then `apps/mobile/src/__spike-s7-scratch__/` deleted, then `pnpm-lock.yaml` restored with `git checkout` and reinstalled with `pnpm install --frozen-lockfile`. Reason: MOB-2 explicitly says not to select or implement an unvalidated library before S7 concludes, and S7 concluding is an owner decision after reading this document, not something this session can pre-empt by leaving the dependency installed. `git status` is clean of this experiment; `apps/mobile` typecheck and lint were re-run after the revert and both pass (exit 0).

---

## 3. Candidate B — `op-sqlite` + SQLCipher (Plan B per spec-review.md R44)

### 3.1 Findings

| ID | Fact | Status | Evidence |
|---|---|---|---|
| M-09 | `@op-engineering/op-sqlite` lists "SQLCipher is supported as a compilation target" and "FTS5 plugin" as top-level supported features. Encryption is a first-class `open()` parameter (`open({ name, encryptionKey })`), not a post-open `PRAGMA`, based on the library's own documented TypeORM adapter example. | VALIDATED (docs) | `github.com/OP-Engineering/op-sqlite` `README.md` (raw fetch); `op-engineering.github.io/op-sqlite/docs/ORM_Libs/` |
| M-10 | `op-sqlite` has an official, documented Drizzle integration (`orm.drizzle.team/docs/connect-op-sqlite`) plus a maintained example repo (`OP-Engineering/op-sqlite-drizzle-example`), listed directly on `op-sqlite`'s own "ORMs & Libs" doc page. | VALIDATED (docs) | `op-engineering.github.io/op-sqlite/docs/ORM_Libs/`, fetched 2026-09-28 |
| M-11 | Cannot be used with Expo Go; no Expo config plugin is required/exists — "just make sure the pods are properly setup" and run `npx expo prebuild`. **`op-sqlite` documents an explicit compilation clash with `expo-sqlite` and `expo-updates`** (duplicate SQLite symbols) if both are present in the same app — not a concern for choosing one candidate, but relevant if this project ever needed both for a transition period. | VALIDATED (docs) | `op-engineering.github.io/op-sqlite/docs/installation/`, §"Compilation clashes" |
| M-12 | Package is actively maintained: 218 published versions on npm, latest `18.2.5` published 2026-09-20 (8 days before this session), MIT licensed. | VALIDATED (docs) | `npm` registry dump for `@op-engineering/op-sqlite`, fetched 2026-09-28 |
| M-13 | A SQLCipher/OpenSSL 16 KB page-size alignment issue was reported and fixed: PR `OP-Engineering/op-sqlite#307` ("Updated lib to use openssl with 16 kb support"), merged 2025-08-09, with `objdump` evidence of `libcrypto.so` load segments aligned to `2**14` (16 KB) bytes after the fix. | VALIDATED (docs) | GitHub REST API dump of PR #307 (`merged: true`, `merged_at: 2025-08-09T12:55:09Z`), fetched 2026-09-28 |
| M-14 | A **separate**, later 16 KB issue was reported against the optional `sqlite-vec` extension binary (`libsqlite_vec.so`, unrelated to SQLCipher): issue `OP-Engineering/op-sqlite#348`, filed 2025-11-26 against `op-sqlite@15.1.1`, closed 2025-11-28. The maintainer's only reply was "Go ask in the turso discord plz, I don't compile the library myself" — the issue was closed without an explanation of what fixed it, and no changelog entry was found tying a specific version to a fix for this specific file. | VALIDATED (docs) — issue existence, closure, and dismissive maintainer reply; **root cause / actual fix NEEDS VALIDATION** | GitHub REST API dump of issue #348 and its single comment, fetched 2026-09-28 |
| M-15 | **Maintenance-health flag:** `op-sqlite` is effectively a single-maintainer project (`ospfranco`) for compiled-artifact issues, and the #348 exchange shows the maintainer explicitly declining ownership of a bundled native binary's correctness ("I don't compile the library myself"), redirecting the reporter to a third party's (Turso's) Discord. This is a legitimate maintenance-risk consideration for a project this dependent on encryption correctness, independent of whether the specific bug affects us (we would not need the `sqlite-vec` extension). | ARCHITECTURAL DECISION INPUT | Derived from M-12/M-14 |
| M-16 | `drizzle-orm@0.45.2` (the version already pinned server-side, same check as M-04) also ships a dedicated `drizzle-orm/op-sqlite` driver/session/migrator, confirmed present in the package's `exports`. No feasibility prototype was attempted for `op-sqlite` in this session, though (time/scope; Candidate A is Plan A per R44 and was prioritized) — no type-level or runtime compatibility check equivalent to §2.3 was done for this candidate. | VALIDATED (docs) — driver export exists; runtime/type-level pairing NEEDS VALIDATION | `npm` registry `exports` field of `drizzle-orm@0.45.2`, fetched 2026-09-28 |

---

## 4. Cross-cutting: exact dependency versions checked

| Package | Version checked | Source | Notes |
|---|---|---|---|
| `expo` | `57.0.24` | `apps/mobile/package.json` (already pinned, unchanged by this spike) | |
| `expo-sqlite` | `57.0.3` | npm `dist-tags.sdk-57` / `dist-tags.latest`, 2026-09-11 | What SDK 57 actually resolves; includes the M-06/M-07 fix |
| `drizzle-orm` | `0.45.2` | Already pinned in `apps/server/package.json` and `packages/db/package.json` | Confirmed via npm registry `exports` to ship `drizzle-orm/expo-sqlite` (driver/session/migrator/query) |
| `@op-engineering/op-sqlite` | `18.2.5` (latest, not installed/tested) | npm registry, 2026-09-20 | Not exercised in this session |

---

## 5. What remains unvalidated (blocks V-09 / S7 closing)

None of the following were possible in this session's environment (Windows dev machine, no `ANDROID_HOME`, no Java/JDK, no Android emulator, no EAS credentials configured, no macOS for iOS). They require a real Expo development build (`eas build --profile development` or a local `expo prebuild` + Android Studio/Xcode toolchain) run on real hardware:

1. **Runtime SQLCipher + Drizzle pairing (M-05).** Actually opening a keyed database, wrapping it with `drizzle-orm/expo-sqlite`, and running a real insert/select — proving the documented-but-untested pairing works, not just that it type-checks.
2. **16 KB page-size alignment on a built APK.** Neither M-06/M-07/M-08 (expo-sqlite) nor M-13/M-14 (op-sqlite) were re-verified against an actual APK built from this repo's toolchain — they are strong documentary evidence the upstream fix shipped and is included in the resolved versions, not a reproduction. Verifying requires `npx expo prebuild`, a release APK build, and Android Studio's APK Analyzer (or `llvm-objdump -p libcrypto.so | grep LOAD` on the extracted `.so`), per the method both upstream fixes used.
3. **FTS5 under SQLCipher.** FTS5 availability (M-03) and SQLCipher support (M-01) are each independently documented; nothing found in this session tests FTS5 **combined with** an encrypted (SQLCipher) database specifically.
4. **Drizzle migrations against an encrypted database.** `drizzle-orm/expo-sqlite/migrator` exists (§2.2 M-04) but running an actual migration against a SQLCipher-keyed database was not tested.
5. **Performance at real volume (V-14).** Requires synthetic data at production volume (per `spec-review.md` §13: portfolio size per representative, prices per customer × table × exceptions, item history) measured on an **entry-level Android device** — initial load, incremental sync, search, and database file size. Nothing in this session approximates that; it needs real or realistic representative-count/product-count numbers, which themselves are still open questions elsewhere in the project (Q-02, R42, the Sankhya mirror-depth decision).
6. **`op-sqlite` runtime feasibility.** Even a type-level prototype (equivalent to §2.3) was not attempted for Candidate B in this session.
7. **iOS.** All findings above are Android-specific (the 16 KB page-size requirement is an Android-only concern); nothing here was checked for iOS/macOS, and this Windows session cannot build or verify iOS at all.

---

## 6. Architectural decision input (not a decision)

Based only on what was validated in this session:

- Candidate A (`expo-sqlite` + `useSQLCipher`) has **stronger, more specific evidence** than it did when `spec-review.md` R44 flagged it as a risk: the exact 16 KB/SQLCipher bug that motivated the risk is traceable to a specific issue and a specific merged fix, and the version Expo SDK 57 resolves today post-dates that fix by many releases (M-06–M-08). FTS5 and a documented (if not verified-in-combination) Drizzle integration both exist officially (M-03, M-04). The main open risk specific to this candidate is that the **SQLCipher + Drizzle pairing itself has no documented combined test** anywhere upstream (M-05) — the two features are each documented, never together.
- Candidate B (`op-sqlite`) has an equally real, independently-fixed 16 KB/SQLCipher issue (M-13) plus a more ergonomic encryption API (`encryptionKey` at `open()` vs. a post-open `PRAGMA`), but carries a distinct maintenance-health caution (M-15) and was not prototyped at all in this session.
- Neither candidate can be promoted past "documented, plausible, partially version-confirmed" without the device/EAS-build work in §5. **Recommend the owner decide whether to authorize a follow-up session with EAS development-build access (Android, entry-level device or equivalent emulator profile) before V-09 is closed** — that follow-up should attempt items 1–5 of §5 for whichever candidate the owner wants prioritized, and only then should `packages/mobile-db` gain a real schema/driver.

---

## 7. Session log

### 7.1 2026-09-28 — initial S7 research + type-level feasibility session

- Confirmed ground truth: `packages/mobile-db` is a 47-line no-op stub; `apps/mobile` had zero SQLite dependency before this session; `apps/mobile` pins `expo@57.0.24`, `react-native@0.86.3`, `newArchEnabled: true`.
- Fetched and read: `docs.expo.dev/versions/latest/sdk/sqlite/` (full config table, SQLCipher section, Drizzle ORM section); `expo/expo` GitHub issue #39792 + 10 comments; `expo/expo` PR #40781; `expo-sqlite` CHANGELOG on the `sdk-57` branch; `expo-sqlite` npm registry version/time history; `orm.drizzle.team/docs/sqlite/connect-expo-sqlite`; `drizzle-orm@0.45.2` npm registry `exports`; `OP-Engineering/op-sqlite` `README.md`, `docs/installation/`, `docs/ORM_Libs/`, `docs/changelog/` (API Changes only); `OP-Engineering/op-sqlite` npm registry version/time history; GitHub issue search + issue/PR detail for `op-sqlite` 16 KB reports (#348, #307, #275, #241, #366, #297).
- Installed `expo-sqlite@57.0.3` + `drizzle-orm@0.45.2` into `apps/mobile` (`pnpm add`), wrote a throwaway type-level prototype (never committed, never wired into `packages/mobile-db` or any screen), ran `tsc`, `eslint`, `jest`, and `expo export --platform android` — all passed with no errors. Confirmed no Android SDK / Java / emulator / EAS credentials are available in this session's environment (`ANDROID_HOME` unset, no `java` on `PATH`), so no native build or on-device test was attempted.
- Reverted the experimental install in full: `pnpm remove expo-sqlite drizzle-orm`, deleted the scratch prototype directory, restored `pnpm-lock.yaml` via `git checkout`, reinstalled with `pnpm install --frozen-lockfile`. Re-ran `apps/mobile` typecheck and lint after the revert — both pass. `git status` confirmed clean of this experiment (only pre-existing, unrelated untracked paths remain).
- Did not touch `docs/roadmap.md`, `docs/decisions.md`, `app.json`, or any file under `packages/mobile-db`.

### 7.2 2026-09-30 — S7 executed on a real device

- Local Android toolchain set up on Windows (SDK, JDK 17, VC++ runtime, LongPathsEnabled, cmake 3.31.4, Ninja 1.13.2 — paths over 260 chars break older Ninja/cmake). Debug dev-client APK (`br.com.plac.salesforce.dev`) built locally and installed by `adb` on Samsung SM-M556B (R9QX5042B5K, Android 16, page size 4096). Metro over `adb reverse tcp:8081`. No EAS/cloud.
- Diagnostics (`apps/mobile/src/dev/s7-diagnostics.ts`, dev-only, gated by `EXPO_PUBLIC_S7_DIAGNOSTICS=1`) read from logcat (`S7RESULT`/`S7DONE`). Final pass: all steps ok, including a run with airplane mode on and Wi-Fi off (bundle delivered over USB). See §8.1.

---

## 8. S7 result and design record (2026-09-30)

### 8.1 Evidence — VALIDADO EM DISPOSITIVO REAL (SM-M556B, Android 16, Hermes, New Architecture)

| Item | Result |
|---|---|
| SQLCipher 4.7.0 community / SQLite 3.49.1; app schema v1 (`sync_metadata`, `outbox`) applied | PASS |
| Persistence after `am force-stop` + relaunch (rows 34→35, 38→39 on later launches) | PASS |
| Transactions: commit; rollback restores state | PASS |
| Drizzle over the keyed connection (insert + select) | PASS |
| Migration v1→v2 preserving data (scratch DB, not the real app DB) | PASS |
| Encryption on disk: no plaintext header; open without key and with wrong key rejected | PASS |
| Performance, 20k synthetic rows: insert 1.9–2.6 s (500 rows/statement; 71.6 s with one statement per row), indexed point query 5–36 ms, LIKE 17–63 ms | indicative, NOT V-14 |
| Offline (airplane mode on, Wi-Fi off) | PASS |
| FTS5 | **FAIL — native SIGABRT** (Scudo invalid chunk state in `libexpo-sqlite.so`) in 4 variants, including an unkeyed database; cause not isolated |
| Emulator / iOS / 16 KB release build / real volume (V-14) | NOT VERIFIED |

Node tests (`node:sqlite` fake connection) cover the migrator, key handling and serialized transactions: 18/18. They prove logic, not the native library.

### 8.2 Architecture

`packages/mobile-db`: `connection.ts` (serialized connection: FIFO lock, BEGIN IMMEDIATE/COMMIT/ROLLBACK, nested transactions refused), `migrator.ts` + `migrations.ts`, `key.ts` (`KeyStore`, `KeyMissingError`), `expo.ts` (the only import of `expo-sqlite`). `apps/mobile/src/db` supplies the secure-store key store and the app database name.

### 8.3 Future local model (design; P-20: no cost/margin column anywhere)

`sync_metadata` (cursor/watermark per dataset, last sync, protocol version) · `customers` · `products` (normalized search columns, indexed) · `pricing_context` (prices as delivered; missing price ≠ 0) · `negotiation_config` (discount authority, payment terms) · `local_order_drafts` · `local_order_items` · `local_discounts` · `outbox` · `sync_conflicts`. Cache is server-authoritative and replaced by scoped bundles; cleanup never deletes rows referenced by a pending outbox command.

### 8.4 Outbox, idempotency, conflicts

- Columns: local id, `operation_id` (unique), type, payload, created_at, attempts, state (`pending|sending|accepted|rejected|needs_review|conflict`), last_error, `idempotency_key` (unique), `base_version`.
- The idempotency key is the `clientRequestId` already used by online `POST /orders`, minted once when the operation is created and reused on every retry, so a resend after a dropped connection returns the stored outcome instead of creating a second order. Same key with a different payload is an idempotency conflict, never a second effect.
- `base_version` carries the `expectedVersion` the edit was made against; a mismatch becomes state `conflict` (user resolves), never blind last-write-wins. A stale price goes through `revisao_preco` (P-09). The server revalidates everything (P-08). Sankhya delivery stays downstream in the server `integration_outbox`; the two outboxes are never merged.
- A `sending` row found at startup is an unknown outcome and is resent with the same key.

### 8.5 Auth and secret storage

The local database never holds a password, refresh token, integration secret or ERP credential. Only the database key lives in `expo-secure-store`. The current mobile session is the interim native HttpOnly cookie (app code stores no token); AUTH-1/2 remain PROPOSED. Revocation wipes the database file and key.

### 8.6 Security review — `GET /products/{code}`

No cost/margin exposure found in the code path. MEDIUM: no server integration test asserts absence of cost/margin keys in `/products`, `/products/{code}` and `/product-resolutions` for every role; to be added as a separate commit.

### 8.7 Running the app on a phone (LAN dev only)

From `apps/mobile`: `EXPO_PUBLIC_API_URL=http://<PC LAN IPv4>:3000 npx expo start --dev-client --port 8081 --lan`; install with `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`; open the app, or `adb reverse tcp:8081 tcp:8081` and `am start -a android.intent.action.VIEW -d "exp+plac-sales-force://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081"`. The API must listen on the LAN interface with a Windows Firewall rule for the private profile only; never localhost from the phone, never exposed to the internet. Cleartext HTTP to the LAN IP and cookie/CORS behavior on the dev build were NOT verified in this spike.

### 8.8 Offline slice on the real device — result (2026-09-30, SM-M556B, LAN dev API)

Validated by hand on the phone with the compose dev API on the private LAN address (no production, no Sankhya):

| Step | Result |
|---|---|
| Login over cleartext HTTP to the LAN IP, cookie session, initial sync, 250 customers and the catalog cached | OK (closes the "cleartext HTTP / cookie" gap of §8.7 for the dev build) |
| Airplane mode on (`airplane_mode_on=1`, no active network) | Cached customers and products browsable, "Sem conexão — alterações salvas neste dispositivo" |
| Offline: customer, product, quantity 3, discount 10 %, save | Saved locally, "Aguardando envio"; total R$ 873,96 computed by `@salesforce/domain` |
| Force-stop, reopen offline | Offline session accepted (AUTH-2 gate, PROPOSED); draft, item, quantity, discount and total intact |
| Airplane mode off | Sync ran unattended; app shows "✓ Sincronizado" and "Pedido nº 6 · R$ 873,96" |
| Backend | `sales_order` 5 → 6; one `POST /orders` in the API log; item 70572 × 3, 323.690000, 10.00 %, total 873.96; `client_request_id` unique (6 orders, 6 distinct ids) |

Not observable from outside: the local outbox/`remote_id` rows (SQLCipher); the accepted state and local→remote link are evidenced by the draft showing the server number and "Sincronizado", and by `packages/mobile-db` tests. The lost-response retry is covered by tests only, not forced on the device. `integration_outbox` stays empty: ERP submission remains disabled (SNK-5 gates).

Open findings: the on-screen keyboard covers the quantity/discount fields in the cart (no keyboard avoidance); the drafts list shows no total while the order is unsent; full-snapshot pull (V-14); cached prices come from the reference table, not the customer's table.

Server: `/products` integration tests against Docker PostgreSQL passed 38/38 (2 files), including the no-cost/margin assertion for every role (P-20).
