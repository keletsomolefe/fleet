import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

const [serial, version] = process.argv.slice(2);
assert.ok(
  serial && /^\d+$/.test(version ?? ""),
  "Usage: pnpm mobile:test:startup <device-serial> <expected-version-code>",
);
const sdk =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  join(homedir(), "Library/Android/sdk");
const candidate = join(sdk, "platform-tools/adb");
const executable = existsSync(candidate) ? candidate : "adb";
const app = "com.vhhfleet.driver";
function adb(...args) {
  return execFileSync(executable, ["-s", serial, ...args], {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function diagnostics() {
  const logs = adb("logcat", "-b", "crash", "-d", "-v", "brief");
  const own = logs
    .split(/(?=^[^\n]*FATAL EXCEPTION)/m)
    .filter((block) => block.includes(`Process: ${app},`))
    .at(-1);
  if (own) console.error(own.slice(0, 4000));
}
const installed = adb("shell", "dumpsys", "package", app);
assert.match(
  installed,
  new RegExp(`versionCode=${version}\\b`),
  "Install the intended signed release APK before testing",
);
assert.ok(
  !/pkgFlags=\[[^\]]*\bDEBUGGABLE\b/.test(installed),
  "Startup checks must use the release APK",
);
for (let run = 1; run <= 2; run++) {
  const started = adb(
    "shell",
    "am",
    "start",
    "-W",
    "-S",
    "-n",
    `${app}/.MainActivity`,
  );
  assert.ok(!/Error:|Exception:/.test(started), started);
  await setTimeout(8000);
  let pid = "";
  try {
    pid = adb("shell", "pidof", app);
  } catch {}
  if (!pid) {
    diagnostics();
    throw new Error(`Release ${version} crashed during cold start ${run}`);
  }
  console.log(
    `PASS release ${version} cold start ${run}: process remains running`,
  );
}
