#!/usr/bin/env bash
set -euo pipefail

# =============================================================
# CONFIGURATION
# =============================================================

# MONTHLY_THRESHOLD=30
# YEARLY_THRESHOLD=12
MONTHLY_THRESHOLD=2
YEARLY_THRESHOLD=2
MANIFEST="manifest.json"

# Internet Archive configuration
IA_PREFIX="test_desuarchive_mlp"
IA_SUBJECTS="desuarchive;/mlp/;mlp"

# =============================================================
# ENVIRONMENT CHECKS
# =============================================================

for cmd in jq gh gzip node; do
  command -v "$cmd" >/dev/null 2>&1 ||
    { echo "Required command '$cmd' not found. Aborting."; exit 1; }
done

if ! command -v ia >/dev/null 2>&1; then
  echo "'ia' CLI not found. Install with 'pip install internetarchive' and configure with 'ia configure'."
  exit 1
fi

[[ -f "$MANIFEST" ]] || { echo "'$MANIFEST' not found."; exit 1; }

# =============================================================
# UTILITIES
# =============================================================

commit_and_tag() {
  local TAG="$1"
  if ! git log --format=%s | grep -qx "$TAG"; then
    git add "$MANIFEST"
    git commit -m "$TAG"
    git push
  fi
  if ! git rev-parse "$TAG" >/dev/null 2>&1; then
    git tag "$TAG"
    git push origin "$TAG"
  fi
}

# TEMPORARY TEST OVERRIDE
if jq -e '.lastDownLoaded' "$MANIFEST" >/dev/null 2>&1; then
  LATEST=$(jq '.lastDownLoaded + 2' "$MANIFEST")
  export OVERRIDE_LATEST_POST="$LATEST"
  echo "⚙️  OVERRIDE_LATEST_POST set to $OVERRIDE_LATEST_POST (for testing)"
else
  echo "⚠️  Could not read .lastDownLoaded from $MANIFEST"
fi

# =============================================================
# STEP 0 — UPDATE LOCAL DATA (DOWNLOADER)
# =============================================================
echo "Running downloader.js to synchronize latest data..."
if ! node downloader.js; then
  echo "downloader.js failed. Aborting archive consolidation."
  exit 1
fi
echo "downloader.js completed successfully."

# =============================================================
# STAGE 1 — HANDLE DAILIES
# =============================================================

DAILY_COUNT=$(jq '.daily | length' "$MANIFEST" 2>/dev/null || echo 0)
echo "Found $DAILY_COUNT daily archives listed."

if (( DAILY_COUNT == 0 )); then
  echo "No new daily data to process."
else
  LAST_DAILY=$(jq -r '.daily[-1]' "$MANIFEST" 2>/dev/null || true)
  DAILY_FILE="daily_${LAST_DAILY}.ndjson"
  TAG="daily_${LAST_DAILY}"

  echo "Processing today's daily archive ($DAILY_FILE)..."
  [[ -f "$DAILY_FILE" ]] || { echo "❌ Missing $DAILY_FILE"; exit 1; }

  if ! gh release view "$TAG" >/dev/null 2>&1; then
    echo "Uploading daily archive to GitHub Releases..."
    commit_and_tag "$TAG"
    gh release create "$TAG" "$DAILY_FILE" \
      --title "Daily Archive ${LAST_DAILY}" \
      --notes "Automated upload of /mlp/ daily scrape ${LAST_DAILY}"
  else
    echo "Daily release '$TAG' already exists; skipping upload."
  fi
fi

# =============================================================
# STAGE 2 — DAILIES → MONTHLY
# =============================================================

DAILY_COUNT=$(jq '.daily | length' "$MANIFEST" 2>/dev/null || echo 0)
if (( DAILY_COUNT >= MONTHLY_THRESHOLD )); then
  echo "Consolidating $DAILY_COUNT daily archives into a monthly archive..."

  readarray -t DAILY_LIST < <(jq -r '.daily[]' "$MANIFEST")
  FIRST="${DAILY_LIST[0]}"
  LAST="${DAILY_LIST[-1]}"
  START=$(echo "$FIRST" | grep -oE '[0-9]+' | head -1)
  END=$(echo "$LAST" | grep -oE '[0-9]+' | tail -1)

  MONTHLY="monthly_${START}_${END}"
  MONTHLY_FILE="${MONTHLY}.ndjson"
  MONTHLY_GZ="${MONTHLY_FILE}.gz"
  >"$MONTHLY_FILE"

  # Merge daily files (download missing ones if not local)
  for D in "${DAILY_LIST[@]}"; do
    F="daily_${D}.ndjson"
    [[ -f "$F" ]] || gh release download "daily_${D}" -p "$F" || {
      echo "Could not retrieve daily_${D}.ndjson"
      exit 1
    }
    cat "$F" >>"$MONTHLY_FILE"
  done

  echo "Compressing monthly archive with maximum compression..."
  gzip -9 -c "$MONTHLY_FILE" >"$MONTHLY_GZ"

  # Replace daily → monthly in manifest
  jq --arg name "$MONTHLY" '.daily = [] | .monthly += [$name]' \
    "$MANIFEST" >tmp && mv tmp "$MANIFEST"

  if ! gh release view "$MONTHLY" >/dev/null 2>&1; then
    echo "Uploading monthly archive to GitHub Releases..."
    commit_and_tag "$MONTHLY"
    gh release create "$MONTHLY" "$MONTHLY_GZ" \
      --title "Monthly Archive ${START}-${END}" \
      --notes "Combined /mlp/ daily archives ${START}-${END}"
  fi

  echo "Removing old daily releases..."
  for D in "${DAILY_LIST[@]}"; do
    R="daily_${D}"
    gh release delete "$R" -y 2>/dev/null || true
    git push --delete origin "$R" 2>/dev/null || true
    git tag -d "$R" 2>/dev/null || true
  done
fi

# =============================================================
# STAGE 3 — MONTHLIES → YEARLY
# =============================================================

MONTHLY_COUNT=$(jq '.monthly | length' "$MANIFEST" 2>/dev/null || echo 0)
if (( MONTHLY_COUNT >= YEARLY_THRESHOLD )); then
  echo "Consolidating $MONTHLY_COUNT monthly archives into a yearly archive..."

  readarray -t MONTHLY_LIST < <(jq -r '.monthly[]' "$MANIFEST")
  FIRST="${MONTHLY_LIST[0]}"
  LAST="${MONTHLY_LIST[-1]}"
  START=$(echo "$FIRST" | grep -oE '[0-9]+' | head -1)
  END=$(echo "$LAST" | grep -oE '[0-9]+' | tail -1)

  YEARLY="yearly_${START}_${END}"
  YEARLY_FILE="${YEARLY}.ndjson"
  YEARLY_GZ="${YEARLY_FILE}.gz"
  >"$YEARLY_FILE"

  echo "Combining monthly .gz archives..."
  for M in "${MONTHLY_LIST[@]}"; do
    GZ="${M}.ndjson.gz"
    [[ -f "$GZ" ]] || gh release download "$M" -p "$GZ"
    gzip -dc "$GZ" >>"$YEARLY_FILE"
  done

  echo "Compressing yearly archive..."
  gzip -9 -c "$YEARLY_FILE" >"$YEARLY_GZ"

  IA_ID="${IA_PREFIX}_${START}_${END}_$(date +%Y%m%d%H%M%S)"
  echo "Uploading yearly archive to Internet Archive..."
  ia upload "$IA_ID" "$YEARLY_GZ" \
    --metadata="title:${YEARLY}" \
    --metadata="subject:${IA_SUBJECTS}" \
    --metadata="mediatype:data" \
    --metadata="creator:filrin123"

  IA_URL="https://archive.org/download/${IA_ID}/$(basename "$YEARLY_GZ")"

  jq --arg name "$YEARLY" --arg url "$IA_URL" \
    '.monthly = [] | .yearly += [{"name":$name,"url":$url}]' \
    "$MANIFEST" >tmp && mv tmp "$MANIFEST"

  echo "Committing updated manifest..."
  commit_and_tag "$YEARLY"

  echo "Cleaning up GitHub monthly releases..."
  for M in "${MONTHLY_LIST[@]}"; do
    gh release delete "$M" -y 2>/dev/null || true
    git push --delete origin "$M" 2>/dev/null || true
    git tag -d "$M" 2>/dev/null || true
  done

  echo "Yearly archive uploaded to Internet Archive: $IA_URL"
fi

# =============================================================
# WRAP-UP
# =============================================================
echo "Release process completed successfully."