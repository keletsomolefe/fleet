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
  // APP_ENV is also available while EAS resolves this config on the local machine.
  const staging =
    process.env.APP_ENV === "staging" ||
    process.env.EAS_BUILD_PROFILE === "staging";
  const apiUrl = staging
    ? "https://fleet.nativesounds.co.za/api"
    : (process.env.EXPO_PUBLIC_API_URL ??
      rootEnv.EXPO_PUBLIC_API_URL ??
      "http://127.0.0.1:3042/api");
  if (apiUrl && !/^https?:\/\//.test(apiUrl))
    throw new Error("EXPO_PUBLIC_API_URL must be an HTTP(S) URL.");
  const development =
    !staging &&
    process.env.NODE_ENV !== "production" &&
    !["preview", "production"].includes(process.env.EAS_BUILD_PROFILE ?? "");
  if (!development && (!apiUrl || !apiUrl.startsWith("https://")))
    throw new Error(
      "Release mobile builds require an HTTPS EXPO_PUBLIC_API_URL.",
    );
  return {
    ...config,
    name: "VHH Fleet",
    slug: "fleet",
    extra: { ...config.extra, apiUrl },
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
        {
          android: {
            usesCleartextTraffic: development,
            // Room creates WorkManager's database by reflection. Its upstream
            // class-only keep rule lets R8 full mode remove the constructor.
            extraProguardRules: `-keep class androidx.work.impl.WorkDatabase_Impl {
    public <init>();
}`,
          },
        },
      ],
    ],
  };
};
