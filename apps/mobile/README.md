# Fleet mobile

Native Expo SDK 58 app with one email/Driver ID sign-in form for personal-phone driving and administrator vehicle-conflict review, with free native background location logging. See [location durability and deployment](../../docs/background-location.md). See [the setup, security and API guide](../../docs/mobile-device-setup.md).

Run all commands from the repository root:

```sh
pnpm install
pnpm infra:up
pnpm dev
# Another terminal:
pnpm mobile:reverse
pnpm mobile:android
# Subsequent runs with the installed development build:
pnpm mobile:start --localhost --port 8081
```

For iOS, use `pnpm mobile:ios`. Configure the public `EXPO_PUBLIC_API_URL` in the root `.env` for a physical device or non-default gateway. Android uses loopback through `adb reverse`; the script forwards Expo, gateway and all configured local infrastructure ports. Pass a device serial after `pnpm mobile:reverse` when several devices are attached.

Android builds were verified with Java 17. Set `JAVA_HOME` to a JDK 17 installation and `ANDROID_HOME` to the Android SDK. If Gradle exits under memory pressure, retry with `GRADLE_OPTS='-Dorg.gradle.workers.max=2 -Dorg.gradle.parallel=false' pnpm mobile:android`. Keep machine-specific JDK paths out of shared configuration.

The application uses Expo Router, SecureStore, local SVG assets, Montserrat and the existing monochrome theme. Fleet logos are exported from `assets/brand/fleet`; original VHH assets remain available. Native projects are generated with `pnpm --filter mobile prebuild` and ignored by Git. Native settings belong in `app.json`, `app.config.ts` and config plugins. The reference `~/Dev/brocabs` workflow informed local native development commands; no application credentials or integrations were copied.

The display name, icons and splash screen use Fleet. The existing `com.vhhfleet.driver` application identifiers and `vhh-fleet` URL scheme are retained for installed-app compatibility, including saved sessions. The old installation credential is retained only to drain historical location records; new driving uses per-session upload credentials. Rebuild the native app with `pnpm mobile:android` or `pnpm mobile:ios` after changing launcher branding.

Run `pnpm mobile:check`, `pnpm test:tracking-queue` and `pnpm test:mobile` before delivery. The latter requires the migrated local database, Kratos and gateway. The web target is a visual preview; credential flows require an installed native build.

Build a staging app from the repository root:

```sh
pnpm mobile:build:staging --platform android
# Or for registered iOS devices:
pnpm mobile:build:staging --platform ios
```

The `staging` EAS profile sets `APP_ENV=staging` and always uses `https://fleet.nativesounds.co.za/api`, including when the root `.env` points to a local gateway. Android produces an installable release APK; iOS uses internal device distribution. Both require HTTPS and run without a development server. EAS login, project linking and signing setup are required on the first build. These commands start a cloud build; no build is started by configuring the profile.

Local development still uses `EXPO_PUBLIC_API_URL` from the environment or root `.env`. The development EAS profile builds a development client. Other release profiles must supply an HTTPS `EXPO_PUBLIC_API_URL`.
