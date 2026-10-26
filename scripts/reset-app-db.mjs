import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const env = parseEnv(readFileSync(new URL("../.env", import.meta.url), "utf8"));
if (!process.argv.includes("--yes"))
  throw new Error(
    "This deletes local application data. Run pnpm db:reset --yes to confirm.",
  );
if (
  process.env.NODE_ENV === "production" ||
  env.NODE_ENV === "production" ||
  !["127.0.0.1", "localhost"].includes(new URL(env.DATABASE_URL).hostname)
)
  throw new Error(
    "Application reset is limited to the local development stack.",
  );
const reset = spawnSync(
  "docker",
  [
    "compose",
    "exec",
    "-T",
    "postgres",
    "sh",
    "-c",
    'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v app_role="$APP_DB_USER"',
  ],
  {
    cwd: root,
    input: `BEGIN;
DROP SCHEMA app CASCADE;
CREATE SCHEMA app AUTHORIZATION :"app_role";
REVOKE ALL ON SCHEMA app FROM PUBLIC;
COMMIT;
`,
    encoding: "utf8",
  },
);
if (reset.status !== 0) {
  process.stderr.write(reset.stderr ?? "Could not reset the app schema.");
  process.exit(reset.status ?? 1);
}
for (const command of ["db:migrate", "db:seed"]) {
  const result = spawnSync("pnpm", [command], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(
  "Local application data rebuilt. Kratos identities and schema permissions retained.",
);
