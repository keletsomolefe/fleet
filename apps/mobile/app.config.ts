import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import type { ConfigContext, ExpoConfig } from "expo/config";

// Only this explicit public value is shipped to the app. Shared secrets stay in the root .env.
export default ({ config }: ConfigContext): ExpoConfig => {
  const rootEnvPath = resolve(__dirname, "../../.env");
  const rootEnv = existsSync(rootEnvPath)
    ? parseEnv(readFileSync(rootEnvPath, "utf8"))
    : {};
  const apiUrl =
    process.env.EXPO_PUBLIC_API_URL ??
    rootEnv.EXPO_PUBLIC_API_URL ??
    "http://127.0.0.1:3042/api";
  if (apiUrl && !/^https?:\/\//.test(apiUrl))
    throw new Error("EXPO_PUBLIC_API_URL must be an HTTP(S) URL.");
  const development =
    process.env.NODE_ENV !== "production" &&
    !["preview", "production"].includes(process.env.EAS_BUILD_PROFILE ?? "");
  if (!development && (!apiUrl || !apiUrl.startsWith("https://")))
    throw new Error(
      "Production mobile builds require an HTTPS EXPO_PUBLIC_API_URL.",
    );
  return {
    ...config,
    name: "VHH Fleet",
    slug: "vhh-fleet",
    extra: { apiUrl },
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        ...(development
          ? {
              NSAppTransportSecurity: {
                NSAllowsLocalNetworking: true,
                NSAllowsArbitraryLoads: true,
              },
            }
          : {}),
      },
    },
    plugins: [
      ...(config.plugins ?? []),
      [
        "expo-build-properties",
        { android: { usesCleartextTraffic: development } },
      ],
    ],
  };
};
