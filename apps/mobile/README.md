# VHH Fleet mobile

Native Expo SDK 58 app with one email/Driver ID sign-in form for administrator device enrollment and driver access, with free native background location logging. See [location durability and deployment](../../docs/background-location.md). See [the setup, security and API guide](../../docs/mobile-device-setup.md).

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

The application uses Expo Router, SecureStore, local Figma SVG assets, Montserrat and the VHH theme. Native projects are generated with `pnpm --filter mobile prebuild` and ignored by Git. Native settings belong in `app.json`, `app.config.ts` and config plugins. The reference `~/Dev/brocabs` workflow informed local native development commands; no application credentials or integrations were copied.

Run `pnpm mobile:check`, `pnpm test:tracking-queue` and `pnpm test:mobile` before delivery. The latter requires the migrated local database, Kratos and gateway. The web target is a visual preview; credential flows require an installed native build.

Production builds must supply an HTTPS `EXPO_PUBLIC_API_URL`. The development EAS profile builds a development client; preview/production profiles are available for signing and distribution configuration. No EAS project or cloud build is created by this change.
