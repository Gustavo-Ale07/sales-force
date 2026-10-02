# Staging build (Android) — Sales Force STG

Status: owner-approved 2026-10-02 for staging only. Nothing here has been executed by the agent (no Expo login, no EAS build, no credentials). Production identity and signing are a separate, later decision and are intentionally NOT configured (no `production` profile in `eas.json`, and `APP_VARIANT=production` fails the config).

## Identity and variants

| | development (default) | staging |
|---|---|---|
| `APP_VARIANT` | unset / `development` | `staging` |
| Android package / iOS bundle id | `br.com.plac.salesforce.dev` | `br.com.plac.salesforce.staging` |
| Name / scheme | Force / `salesforce` | Sales Force STG / `salesforce-stg` |
| API | LAN/dev (`EXPO_PUBLIC_API_URL`, http allowed only by the existing dev-only cleartext flags) | `https://force-staging.sistemasplac.com.br`, https only |
| Bundle | dev client or local standalone (unchanged) | standalone release bundle: no Metro, no dev client |

Production id (planned `br.com.plac.salesforce`, or a definitive id documented before launch) is not set anywhere. A Play/App Store id change later means a new app: decide before launch.

## Build-time guard (fail-closed)

`app.config.js` applies `app-variant.js` to the base `app.json`. For `APP_VARIANT=staging` the config load (hence `eas build`, `expo prebuild`, `expo config`) throws if:

- `EXPO_PUBLIC_API_URL` is empty, not a bare origin, not `https://`, or its host is localhost, a single-label/`.local`/`.lan`/`.internal` name, a private/loopback/link-local/CGNAT IP, `10.0.2.2`, an IPv6 local address, or a numeric/hex IP form;
- `SF_ALLOW_CLEARTEXT` or `EXPO_PUBLIC_ALLOW_CLEARTEXT` is set (any value), or `SF_BUILD_PROFILE`/`EXPO_PUBLIC_BUILD_PROFILE` is a dev profile;
- debug signing is configured (`SF_DEBUG_SIGNING`, a keystore env var pointing at `debug.keystore`, or debug signing in the Android config).

The existing `plugins/with-dev-cleartext.js` stays in the plugin list and writes `usesCleartextTraffic="false"` whenever `SF_ALLOW_CLEARTEXT` is unset, so staging manifests forbid cleartext. The JS side (`src/config.ts`) also refuses `http:` outside `__DEV__` unless the dev flags are present. Tests: `src/dev/app-variant.test.ts`.

The `staging` profile in `eas.json` sets `APP_VARIANT`, `SF_BUILD_PROFILE=staging`, `EXPO_PUBLIC_BUILD_PROFILE=staging` and `EXPO_PUBLIC_API_URL` (the project's real mechanism: `EXPO_PUBLIC_*` is inlined at bundle time). `distribution: internal`, `buildType: apk` (an APK installs directly from the EAS internal link/QR; an AAB cannot be sideloaded and is only needed for Play, a later decision), `autoIncrement: true` with `appVersionSource: remote` (EAS owns `versionCode`).

## Signing strategy

- Staging has its own signing key. The `debug.keystore` is never used.
- EAS-managed credentials for the `staging` profile (EAS generates and stores the upload/signing keystore on Expo servers). Acceptable for staging.
- Never commit keystores, passwords, key aliases/passwords, `credentials.json` or Google service files (`.gitignore` covers `*.jks`, `*.keystore`, `credentials.json`, `google-services.json`, `GoogleService-Info.plist`, `*.p8`, `*.p12`). Do not use `credentialsSource: local`.
- Production signing (Play App Signing vs. own key) is a separate decision.

## Steps the owner must do (not executed by the agent)

1. Use an Expo account owned by the company (not personal); enable MFA on it before anything else.
2. `npm i -g eas-cli` (or `npx eas-cli`), then `eas login`.
3. From `apps/mobile`: `eas init` (links the project; this writes `extra.eas.projectId`/`owner` into the config, review and commit that diff deliberately).
4. `eas credentials --platform android` and select the `staging` profile: let EAS generate the managed keystore.
5. Back up the credentials immediately: in the same menu download the keystore, store it with its alias/passwords in the company password manager/secure vault (outside the repo); record the SHA-1/SHA-256 fingerprints. Losing the key means users must reinstall under a new key.
6. Confirm the API is live at `https://force-staging.sistemasplac.com.br` with a valid certificate (the guard checks the URL shape, not reachability).
7. Build: `eas build --platform android --profile staging`. Install via the internal distribution link; verify the app shows "Sales Force STG", logs in against staging, and that a `http://` URL is refused.
8. Staging sends nothing to production Sankhya; do not put secrets in `eas.json` env (all values there are public and inlined into the bundle). Secrets, if ever needed, use EAS secrets and never `EXPO_PUBLIC_*`.

Validate locally without Expo servers: `APP_VARIANT=staging EXPO_PUBLIC_API_URL=https://force-staging.sistemasplac.com.br EXPO_OFFLINE=1 npx expo config --type public`.

## Not covered

iOS (needs Apple account/EAS credentials; the bundle id is set, nothing else), Play Store, production profile, OTA updates channel, Sentry. No build was run, so the built APK's manifest and signature are unverified.
