declare const __APP_VERSION__: string | undefined;

import packageJson from "../../package.json";

const buildVersion =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : packageJson.version;

export const APP_VERSION = buildVersion;
