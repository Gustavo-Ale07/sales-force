// Build-variant selection and fail-closed staging guard for app.config.js (plain CommonJS, loaded by Expo and by jest).
// APP_VARIANT: unset/"development" keeps the existing dev identity from app.json; "staging" is the first
// distributable identity (owner-approved 2026-10-02). There is deliberately no "production" variant yet: the
// production application id and signing are a separate, later decision, so an unknown variant fails the build.

const STAGING = {
  name: "Sales Force STG",
  scheme: "salesforce-stg",
  applicationId: "br.com.plac.salesforce.staging",
};
const VARIANTS = new Set(["development", "staging"]);

function isPrivateOrLocalHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "::" || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h) || h.startsWith("::ffff:")) return true;
  if (!h.includes(".") && !h.includes(":")) return true; // single-label host (intranet name)
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return /^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h); // numeric host forms that resolve to an IP
}

function isSet(value) {
  return value !== undefined && value !== "";
}

/** Reasons the staging variant must refuse to configure (empty when safe). Pure: takes env and the base config. */
function stagingProblems(env, config = {}) {
  const problems = [];
  const raw = (env.EXPO_PUBLIC_API_URL ?? "").trim();
  if (raw === "") {
    problems.push("EXPO_PUBLIC_API_URL is empty; staging needs the https API origin");
  } else {
    const match = /^(https?):\/\/([^/?#\s@]+)$/i.exec(raw);
    if (!match) problems.push("EXPO_PUBLIC_API_URL must be only an origin (scheme://host[:port], no path, credentials or query)");
    else if (match[1].toLowerCase() !== "https") problems.push("EXPO_PUBLIC_API_URL must use https://");
    else {
      let host = match[2];
      host = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.replace(/:\d*$/, "");
      if (host === "10.0.2.2" || isPrivateOrLocalHost(host)) problems.push(`EXPO_PUBLIC_API_URL host "${host}" is local/private (localhost, LAN, 10.0.2.2 are refused)`);
    }
  }
  if (isSet(env.SF_ALLOW_CLEARTEXT)) problems.push("SF_ALLOW_CLEARTEXT is set; cleartext is never allowed in staging");
  if (isSet(env.EXPO_PUBLIC_ALLOW_CLEARTEXT)) problems.push("EXPO_PUBLIC_ALLOW_CLEARTEXT is set; cleartext is never allowed in staging");
  for (const name of ["SF_BUILD_PROFILE", "EXPO_PUBLIC_BUILD_PROFILE"]) {
    const profile = env[name];
    if (typeof profile === "string" && ["dev", "development"].includes(profile.toLowerCase())) problems.push(`${name} is a dev profile; staging must not run as dev`);
  }
  if (isSet(env.SF_DEBUG_SIGNING)) problems.push("SF_DEBUG_SIGNING is set; staging must never use a debug signing key");
  for (const name of ["SF_ANDROID_KEYSTORE", "ANDROID_KEYSTORE_PATH", "EAS_LOCAL_KEYSTORE"]) {
    if (/debug\.keystore/i.test(env[name] ?? "")) problems.push(`${name} points at debug.keystore; staging must never use a debug signing key`);
  }
  const android = config.android ?? {};
  if (JSON.stringify(android).toLowerCase().includes("debug.keystore") || android.debugSigning !== undefined) problems.push("the Android config references debug signing");
  return problems;
}

/** Applies the APP_VARIANT to the base (app.json) config. Throws on an unknown variant or an unsafe staging setup. */
function applyVariant(config, env = process.env) {
  const variant = (env.APP_VARIANT ?? "development").trim().toLowerCase() || "development";
  if (!VARIANTS.has(variant)) throw new Error(`Unknown APP_VARIANT "${env.APP_VARIANT}". Allowed: development, staging. (No production variant exists until the production decision.)`);
  if (variant === "development") return config;
  const problems = stagingProblems(env, config);
  if (problems.length > 0) throw new Error(`Refusing to configure the staging build:\n- ${problems.join("\n- ")}`);
  const extra = { ...(config.extra ?? {}) };
  delete extra.notice;
  return {
    ...config,
    name: STAGING.name,
    scheme: STAGING.scheme,
    ios: { ...config.ios, bundleIdentifier: STAGING.applicationId },
    android: { ...config.android, package: STAGING.applicationId, allowBackup: false },
    extra: { ...extra, appVariant: "staging" },
  };
}

module.exports = { applyVariant, stagingProblems, isPrivateOrLocalHost, STAGING };
