// Dynamic Expo config: app.json is the base; APP_VARIANT (development | staging) selects the identity.
// See STAGING_BUILD.md. The guard lives in app-variant.js (unit-tested).
const { applyVariant } = require("./app-variant");

module.exports = ({ config }) => applyVariant(config);
