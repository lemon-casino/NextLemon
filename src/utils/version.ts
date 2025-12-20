declare const __APP_VERSION__: string;

const FALLBACK_VERSION = "0.0.0";

export const APP_VERSION =
  typeof __APP_VERSION__ !== "undefined" && __APP_VERSION__
    ? __APP_VERSION__
    : FALLBACK_VERSION;
