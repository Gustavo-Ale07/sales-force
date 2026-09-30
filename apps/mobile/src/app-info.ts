import appConfig from "../app.json";

/** Product name shown to the seller. */
export const PRODUCT_NAME = "Force";

export const APP_VERSION: string = appConfig.expo.version;

/**
 * Environment badge. Only non-production builds show one: a development bundle (`__DEV__`) or a build made with
 * `EXPO_PUBLIC_APP_ENV=dev`. A production build shows no badge.
 */
export const APP_ENVIRONMENT_LABEL: string | null = __DEV__ || process.env.EXPO_PUBLIC_APP_ENV === "dev" ? "DEV" : null;
