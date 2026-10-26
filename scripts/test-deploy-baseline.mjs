import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const database = `fleet_baseline_test_${randomBytes(6).toString('hex')}`;
const directory = mkdtempSync(join(tmpdir(), 'fleet-baseline-'));
const stops = join(directory, 'stops');
function sql(query, target = database) {
  return execFileSync('docker', [
    'compose', 'exec', '-T', ...(target ? ['-e', `POSTGRES_DB=${target}`] : []),
    'postgres', 'sh', '-c',
    'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v app_role="$APP_DB_USER" -v kratos_role="$KRATOS_DB_USER"',
  ], { cwd: root, input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function prepare(expected = 0) {
  const result = spawnSync('bash', ['-c', `
set -Eeuo pipefail
compose() {
  if [[ "$*" == 'stop app' ]]; then
    printf 'stop\n' >> "$FLEET_TEST_STOPS"
  elif [[ "$1" == exec && "$2" == -T ]]; then
    shift 2
    docker compose exec -T -e "POSTGRES_DB=$FLEET_TEST_DATABASE" "$@"
  else
    exit 65
  fi
}
source deploy/prepare-baseline.sh
prepare_launch_baseline
`], { cwd: root, env: {
    ...process.env, FLEET_TEST_DATABASE: database, FLEET_TEST_STOPS: stops,
  }, encoding: 'utf8' });
  assert.equal(result.status, expected, result.stderr || result.stdout);
  return result;
}
const stopCount = () => existsSync(stops) ? readFileSync(stops, 'utf8').trim().split('\n').length : 0;
try {
  sql(`CREATE DATABASE "${database}";`, null);
  sql(`CREATE SCHEMA app AUTHORIZATION :"app_role";
    REVOKE ALL ON SCHEMA app FROM PUBLIC;
    CREATE SCHEMA kratos AUTHORIZATION :"kratos_role";
    REVOKE ALL ON SCHEMA kratos FROM PUBLIC;
    CREATE TABLE kratos.identity_marker (id integer);
    INSERT INTO kratos.identity_marker VALUES (42);`);
  prepare();
  assert.equal(stopCount(), 0);
  console.log('PASS fresh database does not reset or stop the application');

  sql(`CREATE TABLE app.migrations (id serial PRIMARY KEY, name text);
    CREATE TABLE app.data_marker (id integer);
    INSERT INTO app.data_marker VALUES (7);`);
  prepare();
  assert.equal(sql('SELECT id FROM app.data_marker;'), '7');
  sql("INSERT INTO app.migrations(name) VALUES ('UnknownMigration123');");
  assert.match(prepare(1).stderr, /Unrecognized staging migration history/);
  assert.equal(sql('SELECT id FROM app.data_marker;'), '7');
  assert.equal(stopCount(), 0);
  console.log('PASS empty and unrecognized migration histories retain data');

  sql(`TRUNCATE app.migrations;
    INSERT INTO app.migrations(name) VALUES ('CreateUsers1792368000000'), ('DriverSchedules1793102400000'), ('DriverIssues1793102401000');`);
  assert.match(prepare().stdout, /Resetting staging application data/);
  assert.equal(stopCount(), 1);
  assert.equal(sql("SELECT to_regclass('app.migrations') IS NULL AND to_regclass('app.data_marker') IS NULL;"), 't');
  assert.equal(sql('SELECT id FROM kratos.identity_marker;'), '42');
  assert.equal(sql(`SELECT pg_get_userbyid(nspowner) = :'app_role'
    AND NOT has_schema_privilege(:'kratos_role', 'app', 'USAGE')
    AND NOT has_schema_privilege(:'app_role', 'kratos', 'USAGE')
    FROM pg_namespace WHERE nspname = 'app';`), 't');
  console.log('PASS legacy reset clears only application data and retains role isolation');

  sql(`CREATE TABLE app.migrations (id serial PRIMARY KEY, name text);
    INSERT INTO app.migrations(name) VALUES ('LaunchBaseline1793188800000');
    CREATE TABLE app.data_marker (id integer);
    INSERT INTO app.data_marker VALUES (9);`);
  prepare();
  prepare();
  assert.equal(stopCount(), 1);
  assert.equal(sql('SELECT id FROM app.data_marker;'), '9');
  console.log('PASS baseline deployments and retries never repeat the reset');
} finally {
  sql(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE);`, null);
  rmSync(directory, { recursive: true, force: true });
}
