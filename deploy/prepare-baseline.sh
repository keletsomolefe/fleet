#!/usr/bin/env bash
# Sourced by deploy.sh after Postgres is ready. The caller supplies compose().
readonly application_baseline=LaunchBaseline1793188800000

staging_psql() {
  compose exec -T postgres sh -c 'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v app_role="$APP_DB_USER"'
}

prepare_launch_baseline() {
  local has_history history migration
  has_history=$(staging_psql <<<"SELECT to_regclass('app.migrations') IS NOT NULL;")
  [[ "$has_history" == t ]] || return 0
  history=$(staging_psql <<<'SELECT name FROM app.migrations ORDER BY id;')
  [[ -n "$history" ]] || return 0
  if [[ $'\n'"$history"$'\n' == *$'\n'"$application_baseline"$'\n'* ]]; then
    return 0
  fi
  while IFS= read -r migration; do
    case "$migration" in
      CreateUsers1792368000000|UserRoles1792368001000|AdminAccess1792368002000|FleetProfiles1792368003000|MobileDeviceEnrollment1792368004000|LocationTelemetry1792368005000|PersonalPhoneDriving1793016000000|DriverSchedules1793102400000|DriverIssues1793102401000) ;;
      *) printf 'Unrecognized staging migration history; application data was not reset.\n' >&2; return 1 ;;
    esac
  done <<<"$history"
  printf 'Resetting staging application data for %s. Kratos is retained.\n' "$application_baseline"
  compose stop app
  staging_psql <<'SQL'
BEGIN;
SET LOCAL client_min_messages = warning;
DROP SCHEMA app CASCADE;
CREATE SCHEMA app AUTHORIZATION :"app_role";
REVOKE ALL ON SCHEMA app FROM PUBLIC;
COMMIT;
SQL
}
