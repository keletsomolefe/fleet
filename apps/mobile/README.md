# VHH Fleet mobile

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

The display name is VHH Fleet. The launcher icon, splash screen and sign-in screen use the original VHH artwork. The existing `com.vhhfleet.driver` application identifiers and `vhh-fleet` URL scheme are retained for installed-app compatibility, including saved sessions. The old installation credential is retained only to drain historical location records; new driving uses per-session upload credentials. Rebuild the native app after changing launcher branding.

Drivers can report vehicle problems, safety concerns and other issues from their vehicle screen. Administrators receive live MQTT alerts in the shared **Needs attention** inbox on mobile and web, with a red unresolved-count badge. See [reporting and notifications](../../docs/driver-scheduling.md#needs-attention-and-mqtt).

Run `pnpm mobile:check`, `pnpm test:tracking-queue`, `pnpm test:mobile` and `pnpm test:issues` before delivery. The live checks require the migrated local database, Kratos and gateway; issue-alert checks also require MQTT enabled. The web target is a visual preview; credential flows require an installed native build.

Build a staging app from the repository root:

```sh
pnpm mobile:build:staging --platform android
# Build on this machine with the same signing key, without a cloud queue:
pnpm mobile:build:staging:local --platform android --output /absolute/path/vhh-fleet-staging.apk
# Or for registered iOS devices:
pnpm mobile:build:staging --platform ios
```

The `staging` EAS profile sets `APP_ENV=staging` and always uses `https://fleet.nativesounds.co.za/api`, including when the root `.env` points to a local gateway. Android produces an installable release APK; iOS uses internal device distribution. Both require HTTPS and run without a development server. The project is linked to `@patrickkeletso/fleet`; EAS manages Android signing credentials and increments staging build numbers. Signing keys stay outside Git. The root build command runs EAS inside the mobile workspace.

The latest published APK is available at `https://fleet.nativesounds.co.za/downloads/android/latest.apk` and through **Download Android app** on the sign-in page. See [publishing an Android build](../../docs/deployment.md#android-apk-download) for the operator procedure.

Local builds require Java 17 and the Android SDK, run the native Gradle build on this machine, and retrieve the existing signing credentials from EAS. Use the root `pnpm-lock.yaml`; do not add an npm lockfile, which can make EAS choose npm instead of pnpm.

Before publishing, install the signed release APK on an Android test device with `adb -s <serial> install -r <apk>`, then run `pnpm mobile:test:startup <serial> <version-code>`. The check confirms the installed release version and performs two cold starts without clearing app data. Inspect the visible sign-in screen as well. A successful build and signature check do not prove the app can start.

With a signed-in driver, check that **Jobs & activity** opens the activity screen after a cold start and after increasing and restoring Android's text size. Screen handlers use `useRouter()` from their current navigation context. The module-level imperative router can become unbound during Android configuration changes in SDK 58 and throw when a visible button is pressed. Check the actual rendered labels: Android's accessibility tree can contain a full label even when custom-font text is clipped visually.

The Android build properties retain the public no-argument constructor of `androidx.work.impl.WorkDatabase_Impl`. Android's background scheduler creates that database through Room reflection; R8 full mode otherwise removes the constructor and the release app exits before its first screen. Keep this narrow rule when updating SDKs, and repeat the signed-release startup check.

Local development still uses `EXPO_PUBLIC_API_URL` from the environment or root `.env`. The development EAS profile builds a development client. Other release profiles must supply an HTTPS `EXPO_PUBLIC_API_URL`.
