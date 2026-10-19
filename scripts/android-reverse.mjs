import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const path = new URL("../.env", import.meta.url);
const env = existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
const serial = process.argv[2];
const args = serial ? ["-s", serial] : [];
const defaults = {
  MQTT_WS_PORT: 1884,
  GATEWAY_PORT: 3042,
  KRATOS_PORT: 14433,
  KRATOS_ADMIN_PORT: 14434,
  KRATOS_UI_PORT: 14455,
  MAILPIT_PORT: 18025,
  POSTGRES_PORT: 55432,
};
const ports = new Set([
  8081,
  ...Object.entries(defaults).map(([key, value]) =>
    Number(process.env[key] ?? env[key] ?? value),
  ),
]);
for (const port of ports) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid development port configuration.");
  execFileSync("adb", [...args, "reverse", `tcp:${port}`, `tcp:${port}`], {
    stdio: "inherit",
  });
}
execFileSync("adb", [...args, "reverse", "--list"], { stdio: "inherit" });
