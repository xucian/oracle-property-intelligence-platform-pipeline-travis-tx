#!/usr/bin/env bash
# Rebuild the Travis county modules into a kit checkout (soofi-xyz-team-kit at 99c7bff).
# Fetches the pinned kit-mirror repo (MIRROR_REPO @ MIRROR_COMMIT), then runs its apply-to-kit.sh.
# usage: oracle/travis/apply-to-kit.sh /path/to/kit-checkout
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
kit="${1:?kit checkout path}"
url="$(tr -d '[:space:]' < "$here/MIRROR_REPO")"
sha="$(tr -d '[:space:]' < "$here/MIRROR_COMMIT")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git clone --quiet "$url" "$tmp"
git -C "$tmp" checkout --quiet "$sha"
"$tmp/apply-to-kit.sh" "$kit"
