#!/usr/bin/env bash
set -Eeuo pipefail
readonly release=$(cd "$(dirname "$0")" && pwd)
readonly sha=${1:?Commit SHA required}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || exit 64
export FLEET_IMAGE="ghcr.io/keletsomolefe/fleet:$sha"
compose() { docker compose --project-directory "$release" --env-file /opt/fleet/.env -f "$release/compose.yaml" "$@"; }
compose config --quiet
# Image download was authenticated by the receiver before starting this script.
compose up -d --wait --wait-timeout 120 postgres mailpit
compose run --rm -T kratos-migrate
compose up -d --wait --wait-timeout 180 kratos kratos-ui
compose run --rm -T --no-deps app node apps/api/node_modules/typeorm/cli.js migration:run -d apps/api/dist/database/data-source.js
compose run --rm -T --no-deps owner-bootstrap
previous=$(readlink -f /opt/fleet/current || true)
rollout() {
  compose up -d --wait --wait-timeout 300 app edge &&
    curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors https://fleet.nativesounds.co.za/brand/fleet-mark.svg -o /dev/null
}
if ! rollout; then
  if [[ -n "$previous" && -s "$previous/release-sha" ]]; then
    old=$(cat "$previous/release-sha")
    FLEET_IMAGE="ghcr.io/keletsomolefe/fleet:$old" docker compose --project-directory "$previous" --env-file /opt/fleet/.env -f "$previous/compose.yaml" up -d --wait --wait-timeout 180 app edge
    printf 'Fleet rollout failed; previous application image restored. Database migrations were retained.\n' >&2
  fi
  exit 1
fi
printf '%s\n' "$sha" > "$release/release-sha"
ln -sfn "$release" /opt/fleet/current
printf 'Fleet deployed: %s\n' "$sha"
# Remove only obsolete Fleet app images, retaining the current and previous deployments.
while read -r tag; do
  [[ -z "$tag" || "$tag" == "$sha" ]] && continue
  [[ -n "$previous" && -s "$previous/release-sha" && "$tag" == "$(cat "$previous/release-sha")" ]] && continue
  docker image rm "ghcr.io/keletsomolefe/fleet:$tag" >/dev/null 2>&1 || true
done < <(docker image ls ghcr.io/keletsomolefe/fleet --format '{{.Tag}}')
