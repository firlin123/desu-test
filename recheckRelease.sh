#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <release-name>" >&2
    exit 1
fi

NAME="$1"
NAME_RAW="${NAME}.ndjson"
NAME_GZ="${NAME_RAW}.gz"

if ! gh release view "$NAME" &>/dev/null; then
    echo "Error: Release '$NAME' does not exist." >&2
    exit 1
fi

ASSET_DIGEST=$(gh api "repos/:owner/:repo/releases/tags/$NAME" \
  --jq '(.tag_name + ".ndjson.gz") as $n | .assets[] | select(.name == $n) | .digest')

if [[ -z "$ASSET_DIGEST" ]]; then
    echo "Error: Release '$NAME' does not have a ${NAME}.ndjson.gz asset." >&2
    exit 1
fi

ASSET_HASH="${ASSET_DIGEST#sha256:}"

if [[ ! -f "$NAME_GZ" || "$ASSET_HASH" != "$(sha256sum "$NAME_GZ" | awk '{print $1}')" ]]; then
    echo "Downloading asset for release '$NAME'..." >&2
    gh release download "$NAME" -p "$NAME_GZ"
fi

echo "Decompressing asset for release '$NAME'..." >&2
gzip -dc "$NAME_GZ" > "$NAME_RAW"

HASH_BEFORE=$(sha256sum "$NAME_RAW" | awk '{print $1}')

echo "Running reCheck on release '$NAME'..." >&2
if ! node ./reCheck.js "$NAME_RAW"; then
    echo "reCheck failed. Exiting without updating release." >&2
    exit 1
fi

HASH_AFTER=$(sha256sum "$NAME_RAW" | awk '{print $1}')

if [[ "$HASH_BEFORE" == "$HASH_AFTER" ]]; then
    echo "No changes detected after reCheck." >&2
    exit 0
fi

echo "Changes detected after reCheck. Compressing updated asset..." >&2
gzip -9 -c "$NAME_RAW" > "$NAME_GZ"
echo "Uploading updated asset to GitHub Release..." >&2
gh release upload "$NAME" "$NAME_GZ" --clobber
echo "Recheck complete for release '$NAME'." >&2