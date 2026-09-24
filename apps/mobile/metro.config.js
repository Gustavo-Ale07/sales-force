// Expo's default Metro config already understands pnpm workspaces (symlinked packages, workspace watch
// folders, package `exports`). Kept as an explicit file so a monorepo-specific override has an obvious home.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
