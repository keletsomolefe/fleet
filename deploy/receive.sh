#!/usr/bin/env bash
# Installed root-owned at /usr/local/sbin/fleet-receive. The CI key has no shell or forwarding access.
set -Eeuo pipefail
if [[ "${SSH_ORIGINAL_COMMAND:-}" == check ]]; then
  printf 'Fleet deployment key ready.\n'; exit 0
fi
[[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^deploy\ ([0-9a-f]{40})$ ]] || { printf 'Only Fleet deployments are permitted.\n' >&2; exit 64; }
sha=${BASH_REMATCH[1]}
read -r actor
read -r token
[[ "$actor" =~ ^[A-Za-z0-9_-]+$ && -n "$token" ]] || exit 64
exec 9>/opt/fleet/deploy.lock
flock -w 900 9
umask 077
registry=$(mktemp -d /opt/fleet/registry.XXXXXX)
archive=$(mktemp /opt/fleet/release.XXXXXX.tar.gz)
trap 'rm -rf "$registry"; rm -f "$archive"; unset token' EXIT
printf '%s' "$token" | docker --config "$registry" login ghcr.io --username "$actor" --password-stdin >/dev/null
unset token
docker --config "$registry" pull "ghcr.io/keletsomolefe/fleet:$sha"
curl --fail --silent --show-error --location "https://github.com/keletsomolefe/fleet/archive/$sha.tar.gz" --output "$archive"
release="/opt/fleet/releases/$sha"
install -d -m 0700 "$release"
# Extract only trusted deployment files from the fixed Fleet repository at this exact commit.
tar -xzf "$archive" -C "$release" --strip-components=2 "fleet-$sha/deploy"
bash "$release/deploy.sh" "$sha"
