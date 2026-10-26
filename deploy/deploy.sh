#!/usr/bin/env bash
set -Eeuo pipefail
readonly release=$(cd "$(dirname "$0")" && pwd)
readonly sha=${1:?Commit SHA required}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || exit 64
export FLEET_IMAGE="ghcr.io/keletsomolefe/fleet:$sha"
compose() { docker compose --project-directory "$release" --env-file /opt/fleet/.env -f "$release/compose.yaml" "$@"; }
source "$release/prepare-baseline.sh"
stage_config() {
  local source=$1 file
  kratos_changed=false
  edge_changed=false
  install -d -m 0755 /opt/fleet/config/kratos /opt/fleet/config/postgres
  for file in kratos.yml identity.schema.json after-login.jsonnet; do
    cmp -s "$source/kratos/$file" "/opt/fleet/config/kratos/$file" || kratos_changed=true
    install -m 0644 "$source/kratos/$file" "/opt/fleet/config/kratos/$file"
  done
  cmp -s "$source/Caddyfile" /opt/fleet/config/Caddyfile || edge_changed=true
  install -m 0644 "$source/Caddyfile" /opt/fleet/config/Caddyfile
  install -m 0644 "$source"/postgres/*.sql /opt/fleet/config/postgres/
}
compose config --quiet
install -d -m 0755 /opt/fleet/downloads/android/releases
install -d -m 0700 /opt/fleet/downloads/incoming
stage_config "$release"
compose up -d --wait --wait-timeout 120 postgres mailpit
compose run --rm -T kratos-migrate
if "$kratos_changed"; then
  compose up -d --force-recreate --wait --wait-timeout 180 kratos
else
  compose up -d --wait --wait-timeout 180 kratos
fi
compose up -d --wait --wait-timeout 120 kratos-ui
prepare_launch_baseline
compose run --rm -T --no-deps app node apps/api/node_modules/typeorm/cli.js migration:run -d apps/api/dist/database/data-source.js
printf '%s\n' "$application_baseline" > "$release/database-baseline"
compose run --rm -T --no-deps owner-bootstrap
previous=$(readlink -f /opt/fleet/current || true)
rollout() {
  compose up -d --wait --wait-timeout 300 app || return 1
  if "$edge_changed"; then
    compose up -d --force-recreate --wait --wait-timeout 120 edge || return 1
  else
    compose up -d --wait --wait-timeout 120 edge || return 1
  fi
  curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors https://fleet.nativesounds.co.za/design/monogram.svg -o /dev/null || return 1
  curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors https://fleet.nativesounds.co.za/api/ -o /dev/null || return 1
}
if ! rollout; then
  if [[ -n "$previous" && -s "$previous/release-sha" && -s "$previous/database-baseline" && "$(cat "$previous/database-baseline")" == "$application_baseline" ]]; then
    old=$(cat "$previous/release-sha")
    stage_config "$previous"
    FLEET_IMAGE="ghcr.io/keletsomolefe/fleet:$old" docker compose --project-directory "$previous" --env-file /opt/fleet/.env -f "$previous/compose.yaml" up -d --wait --wait-timeout 180 app edge
    printf 'Fleet rollout failed; previous application image restored. Database migrations were retained.\n' >&2
  else
    printf 'Fleet rollout failed; no previous application compatible with this database baseline is available.\n' >&2
  fi
  exit 1
fi
printf '%s\n' "$sha" > "$release/release-sha"
ln -sfn "$release" /opt/fleet/current
printf 'Fleet deployed: %s\n' "$sha"
while read -r tag; do
  [[ -z "$tag" || "$tag" == "$sha" ]] && continue
  [[ -n "$previous" && -s "$previous/release-sha" && "$tag" == "$(cat "$previous/release-sha")" ]] && continue
  docker image rm "ghcr.io/keletsomolefe/fleet:$tag" >/dev/null 2>&1 || true
done < <(docker image ls ghcr.io/keletsomolefe/fleet --format '{{.Tag}}')
