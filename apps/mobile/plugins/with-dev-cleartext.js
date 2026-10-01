// DEV-only: permits http:// to the DEV API in non-debug Android builds.
//
// Why: a standalone (release) build points at the DEV API over the LAN (http://<pc-ip>:3000, no TLS); Android blocks
// cleartext HTTP in release unless the manifest allows it (only the debug manifest does).
// When: active only when SF_ALLOW_CLEARTEXT=1 at `expo prebuild` time. Without it this plugin is a no-op, so the
// default configuration and any production-like build keep cleartext traffic blocked.
// Local DEV test build (never a store/production build):
//   SF_ALLOW_CLEARTEXT=1 EXPO_PUBLIC_ALLOW_CLEARTEXT=1 EXPO_PUBLIC_API_URL=http://<pc-ip>:3000 npx expo prebuild --platform android --clean
//   then gradlew assembleRelease (EXPO_PUBLIC_* are inlined at bundle time). EXPO_PUBLIC_ALLOW_CLEARTEXT is what lets the
//   release JS bundle accept an http: API origin (src/config.ts); without it the app refuses http outside __DEV__.
// Guard: the prebuild FAILS when cleartext is requested together with a production/release profile
// (EAS_BUILD_PROFILE or APP_ENV set to "production"/"release").
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Expo config plugins are CommonJS
const { withAndroidManifest } = require("expo/config-plugins");

const RELEASE_PROFILES = new Set(["production", "release"]);

/** Returns the reason a cleartext build must not proceed, or `null`. Pure: takes the environment as a parameter. */
function cleartextBuildProblem(env) {
  if (env.SF_ALLOW_CLEARTEXT !== "1") return null;
  const profiles = [env.EAS_BUILD_PROFILE, env.APP_ENV].filter((value) => typeof value === "string").map((value) => value.toLowerCase());
  if (profiles.some((profile) => RELEASE_PROFILES.has(profile))) {
    return "SF_ALLOW_CLEARTEXT=1 is set on a production/release build profile. Cleartext HTTP is for local DEV test builds only; unset it (release builds require https).";
  }
  return null;
}

function withDevCleartext(config) {
  const problem = cleartextBuildProblem(process.env);
  if (problem !== null) throw new Error(problem);
  if (process.env.SF_ALLOW_CLEARTEXT !== "1") return config;
  return withAndroidManifest(config, (mod) => {
    mod.modResults.manifest.application[0].$["android:usesCleartextTraffic"] = "true";
    return mod;
  });
}

module.exports = withDevCleartext;
module.exports.cleartextBuildProblem = cleartextBuildProblem;
