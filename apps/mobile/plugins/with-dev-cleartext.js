// DEV-only: permits http:// to the DEV API in non-debug Android builds.
//
// Why: a standalone (release) build points at the DEV API over the LAN (http://<pc-ip>:3000, no TLS); Android blocks
// cleartext HTTP in release unless the manifest allows it (only the debug manifest does).
// When: active only when SF_ALLOW_CLEARTEXT=1 AND SF_BUILD_PROFILE=dev at `expo prebuild` time. Fail-closed: the dev
// profile must be named explicitly (production/staging are never detected, they are simply not "dev"); any other
// combination makes the prebuild FAIL, and without SF_ALLOW_CLEARTEXT the manifest explicitly forbids cleartext.
// Local DEV test build (never a store/staging/production build):
//   SF_ALLOW_CLEARTEXT=1 SF_BUILD_PROFILE=dev EXPO_PUBLIC_ALLOW_CLEARTEXT=1 EXPO_PUBLIC_BUILD_PROFILE=dev \
//   EXPO_PUBLIC_API_URL=http://<pc-ip>:3000 npx expo prebuild --platform android --clean
//   then gradlew assembleRelease (EXPO_PUBLIC_* are inlined at bundle time). The two EXPO_PUBLIC_* flags are what let the
//   release JS bundle accept an http: API origin (src/config.ts); without both it refuses http outside __DEV__.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Expo config plugins are CommonJS
const { withAndroidManifest } = require("expo/config-plugins");

const DEV_PROFILES = new Set(["dev", "development"]);

/** Returns the reason a cleartext build must not proceed, or `null`. Pure: takes the environment as a parameter. */
function cleartextBuildProblem(env) {
  const requested = env.SF_ALLOW_CLEARTEXT;
  if (requested === undefined || requested === "") return null;
  const refusal = (why) => `SF_ALLOW_CLEARTEXT is set but ${why}. Cleartext HTTP is for local DEV test builds only (SF_ALLOW_CLEARTEXT=1 with SF_BUILD_PROFILE=dev); production and staging builds require https.`;
  if (requested !== "1") return refusal(`its value is not exactly "1"`);
  if (typeof env.SF_BUILD_PROFILE !== "string" || env.SF_BUILD_PROFILE.toLowerCase() !== "dev") return refusal("SF_BUILD_PROFILE=dev is not set");
  for (const name of ["EAS_BUILD_PROFILE", "APP_ENV"]) {
    const value = env[name];
    if (typeof value === "string" && value !== "" && !DEV_PROFILES.has(value.toLowerCase())) return refusal(`${name} is "${value}", not a dev profile`);
  }
  return null;
}

function withDevCleartext(config) {
  const problem = cleartextBuildProblem(process.env);
  if (problem !== null) throw new Error(problem);
  const enabled = process.env.SF_ALLOW_CLEARTEXT === "1";
  return withAndroidManifest(config, (mod) => {
    mod.modResults.manifest.application[0].$["android:usesCleartextTraffic"] = enabled ? "true" : "false";
    return mod;
  });
}

module.exports = withDevCleartext;
module.exports.cleartextBuildProblem = cleartextBuildProblem;
