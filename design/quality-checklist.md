# Fleet visual QA

Use this for new screens and changes that affect layout, interaction or accessibility. For review-only requests, capture the current result and report findings. For implementation, capture a baseline when useful, change the screen, and repeat the same check with the same viewport and test data.

## Run the surface

Use the local stack and disposable development data. Protected routes need a local account with the appropriate permissions and an existing `app` schema. Follow the [development setup](../README.md#development) without resetting the database for a UI review. Keep screenshots and logs in the ignored `.design-qa/` folder or attach redacted evidence to the review.

### Web dashboard

1. Start the gateway and app with `pnpm dev` after the local services are up. Open `http://127.0.0.1:3042` (or the configured gateway port) in a browser. Use the gateway for sign-in and authenticated routes.
2. Open the route with browser automation or DevTools. Check a desktop viewport, such as 1440 × 900, and a narrow one, such as 390 × 844. Save a screenshot at each size. Try the primary path with the keyboard, including drawer and dialog focus where applicable.
3. Run `pnpm --filter web typecheck` and `pnpm --filter web test` for web implementation changes. Run the associated live checks when changing authenticated behavior; the feature docs list the commands.

### Native app

Use a booted Android emulator or iOS simulator with a development build. From the root, build and install with `pnpm mobile:android` or `pnpm mobile:ios` the first time; use `pnpm mobile:start` for an existing build. On Android, use `pnpm mobile:reverse` when using the local gateway. See [mobile setup](../docs/mobile-device-setup.md#running-and-verification).

Use the pinned [Callstack Agent Device](https://github.com/callstack/agent-device/tree/v0.21.37) launcher for local inspection. It runs on demand and is separate from the mobile runtime. First use needs access to the npm registry. Run these from the repo root with the app connected to Metro:

```sh
mkdir -p .design-qa
pnpm design:device doctor
pnpm design:device open com.vhhfleet.driver --platform android
pnpm design:device snapshot -i
pnpm design:device screenshot .design-qa/android-driver.png
pnpm design:device close
```

Use `--platform ios` for iOS, with a different screenshot path. Use `press` with a ref from the latest `snapshot -i` to exercise a visible action. If Agent Device is unavailable, use the simulator's screenshot action, `xcrun simctl io booted screenshot .design-qa/ios-driver.png` on a single booted iOS simulator, or `adb -s <serial> exec-out screencap -p > .design-qa/android-driver.png` on Android. An Expo web preview can help check layout; record it as a browser preview. Native keyboard, permissions and offline behavior need a native target. Run `pnpm mobile:check` for mobile implementation changes.

## Review the result

- **Task and hierarchy:** Can a staff member identify what needs attention and what to do next? For a driver, verify the intended registration, current state and action are legible together.
- **States:** Exercise the happy path and a consequential alternate state. Choose from loading, no records, no search matches, validation errors, blocked or offline, and success as relevant. An empty queue and a failed refresh must look different. A submitted or resolved state needs server confirmation.
- **Accessibility and fit:** Check focus order and visible focus on web. On mobile, check safe areas, the open keyboard, touch target size, larger text, and screen-reader names for icon actions. Test a long name or registration and check that status does not depend on color.
- **Evidence:** Record the route, state, platform, viewport or device, and screenshot path. Inspect the saved image and note what you changed after seeing it. A check that could not run should be listed with the reason; a Figma export or passing type check is not evidence of the running UI.
