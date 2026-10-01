// DEV-only: permits http:// to the DEV API in non-debug Android builds.
//
// Why: a standalone (release) build points at the DEV API over the LAN (http://<pc-ip>:3000, no TLS); Android blocks
// cleartext HTTP in release unless the manifest allows it (only the debug manifest does).
// When: active only when SF_ALLOW_CLEARTEXT=1 at `expo prebuild` time. Without it this plugin is a no-op, so the
// default configuration and any production-like build keep cleartext traffic blocked.
// Local DEV test build (never a store/production build):
//   SF_ALLOW_CLEARTEXT=1 EXPO_PUBLIC_API_URL=http://<pc-ip>:3000 npx expo prebuild --platform android --clean
//   then gradlew assembleRelease (EXPO_PUBLIC_* are inlined at bundle time).
const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withDevCleartext(config) {
  if (process.env.SF_ALLOW_CLEARTEXT !== "1") return config;
  return withAndroidManifest(config, (mod) => {
    mod.modResults.manifest.application[0].$["android:usesCleartextTraffic"] = "true";
    return mod;
  });
};
