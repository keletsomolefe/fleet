#!/usr/bin/env bash
# Run as the server operator after uploading incoming/<sha256>.apk.
set -Eeuo pipefail
readonly digest=${1:?APK SHA-256 required}
[[ "$digest" =~ ^[0-9a-f]{64}$ ]] || exit 64
readonly root=/opt/fleet/downloads
readonly incoming="$root/incoming/$digest.apk"
readonly artifact="$root/android/releases/$digest.apk"
[[ -f "$incoming" && ! -L "$incoming" ]] || { printf 'Uploaded APK is missing.\n' >&2; exit 1; }
[[ "$(sha256sum "$incoming" | cut -d ' ' -f 1)" == "$digest" ]] || { printf 'APK checksum mismatch.\n' >&2; exit 1; }
[[ "$(od -An -tx1 -N4 "$incoming" | tr -d ' \n')" == 504b0304 ]] || { printf 'Uploaded file is not an APK archive.\n' >&2; exit 1; }
exec 9>"$root/publish.lock"
flock -n 9 || { printf 'Another Android APK publication is running. Try again.\n' >&2; exit 1; }
install -d -m 0755 "$root/android/releases"
chmod 0644 "$incoming"
mv -f "$incoming" "$artifact"
temporary="$root/android/.latest-$$"
trap 'rm -f "$temporary"' EXIT
ln -s "releases/$digest.apk" "$temporary"
mv -Tf "$temporary" "$root/android/latest.apk"
printf 'Published Android APK: %s\n' "$digest"
