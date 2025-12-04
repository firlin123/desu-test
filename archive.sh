#!/usr/bin/env bash
set -euo pipefail

# =============================================================
# CONFIGURATION
# =============================================================

# Make it force consolidate if we skipped a day/month/year
MONTHLY_THRESHOLD=32
YEARLY_THRESHOLD=13
MANIFEST="manifest.json"

# Internet Archive configuration
IA_PREFIX="desuarchive_mlp"
IA_SUBJECTS="desuarchive;/mlp/;mlp"
# "Community Data" collection ID 
IA_COLLECTION="opensource_media"
IA_CREATOR="firlin123"

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

# =============================================================
# STEP 0 - UPDATE LOCAL DATA (DOWNLOADER)
# =============================================================

echo "Running downloader.js to synchronize latest data..."
if ! node downloader.js; then
  echo "downloader.js failed. Aborting archive consolidation."
  exit 1
fi
echo "downloader.js completed successfully."

# =============================================================
# STAGE 1 - NEW DAILY RELEASE
# =============================================================

DAILY_COUNT=$(jq '.daily | length' "$MANIFEST" 2>/dev/null || echo 0)
CURRENT_HOUR=$(date -u +%H)

if (( DAILY_COUNT > 0 )); then
  echo "Preparing daily archive for upload..."

  DAILY=$(jq -r '.daily[-1]' "$MANIFEST" 2>/dev/null || true)
  DAILY_FILE="${DAILY}.ndjson"
  DAILY_GZ="${DAILY_FILE}.gz"

  START=$(echo "$DAILY" | grep -oE '[0-9]+' | tail -2 | head -1)
  END=$(echo "$DAILY" | grep -oE '[0-9]+' | tail -1)

  # If we're less then halfway through the day, label using previous day
  if (( CURRENT_HOUR < 12 )); then
    DATE_LABEL=$(date -u -d "last day" +%Y.%m.%d)
  else
    DATE_LABEL=$(date -u +%Y.%m.%d)
  fi

  if ! gh release view "$DAILY" >/dev/null 2>&1; then
    echo "Checking for daily archive file..."
    [[ -f "$DAILY_FILE" ]] || { echo "Missing $DAILY_FILE"; exit 1; }

    echo "Compressing daily archive..."
    gzip -9 -c "$DAILY_FILE" >"$DAILY_GZ"
    
    echo "Uploading daily archive to GitHub Releases..."
    commit_and_tag "$DAILY"
    gh release create "$DAILY" "$DAILY_GZ" \
      --title "${DATE_LABEL} daily archive (${START}-${END})" \
      --notes "Automated daily scrape of /mlp/ posts for ${DATE_LABEL} covering posts ${START}-${END}."
  else
    echo "Daily release '$DAILY' already exists; skipping upload."
  fi
fi

# =============================================================
# STAGE 2 - DAILIES -> MONTHLY
# =============================================================

DAILY_COUNT=$(jq '.daily | length' "$MANIFEST" 2>/dev/null || echo 0)
CURRENT_DAY=$(date -u +%d)

# Consolidate either when threshold met or new month starts
if (( DAILY_COUNT >= MONTHLY_THRESHOLD )) || { (( DAILY_COUNT > 0 )) && (( CURRENT_DAY == 01 )); }; then
  echo "Consolidating $DAILY_COUNT daily archives into a monthly archive..."

  readarray -t DAILY_LIST < <(jq -r '.daily[]' "$MANIFEST")
  FIRST="${DAILY_LIST[0]}"
  LAST="${DAILY_LIST[-1]}"
  START=$(echo "$FIRST" | grep -oE '[0-9]+' | tail -2 | head -1)
  END=$(echo "$LAST" | grep -oE '[0-9]+' | tail -1)

  TIMESTAMP="$(date -u +%Y%m%d%H%M%S)"
  MONTHLY="${TIMESTAMP}_monthly_${START}_${END}"
  MONTHLY_FILE="${MONTHLY}.ndjson"
  MONTHLY_GZ="${MONTHLY_FILE}.gz"
  >"$MONTHLY_FILE"

   # If triggered on the 1st, label using the *previous* month
  if (( CURRENT_DAY == 01 )); then
    DATE_LABEL=$(date -u -d "last month" +%Y.%m)
  else
    DATE_LABEL=$(date -u +%Y.%m)
  fi

  echo "Combining daily archives for the ${DATE_LABEL} cycle..."
  for D in "${DAILY_LIST[@]}"; do
    GZ="${D}.ndjson.gz"
    [[ -f "$GZ" ]] || gh release download "$D" -p "$GZ"
    gzip -dc "$GZ" >>"$MONTHLY_FILE"
  done

  echo "Rechecking monthly archive file..."
  if ! node reCheck.js "$MONTHLY_FILE"; then
    echo "reCheck failed. Continuing with rechecked data."
  fi

  echo "Compressing monthly archive..."
  gzip -9 -c "$MONTHLY_FILE" >"$MONTHLY_GZ"

  # Replace daily -> monthly in manifest
  jq --arg name "$MONTHLY" '.daily = [] | .monthly += [$name]' \
    "$MANIFEST" >tmp && mv tmp "$MANIFEST"

  if ! gh release view "$MONTHLY" >/dev/null 2>&1; then
    echo "Uploading monthly archive to GitHub Releases..."
    commit_and_tag "$MONTHLY"
    gh release create "$MONTHLY" "$MONTHLY_GZ" \
      --title "${DATE_LABEL} monthly archive (${START}-${END})" \
      --notes "Automated monthly consolidation of /mlp/ posts for ${DATE_LABEL} covering posts ${START}-${END}."
  fi

  echo "Removing old daily releases..."
  for D in "${DAILY_LIST[@]}"; do
    gh release delete "$D" -y 2>/dev/null || true
    git push --delete origin "$D" 2>/dev/null || true
    git tag -d "$D" 2>/dev/null || true
  done
fi

# =============================================================
# STAGE 3 - MONTHLIES -> YEARLY
# =============================================================

MONTHLY_COUNT=$(jq '.monthly | length' "$MANIFEST" 2>/dev/null || echo 0)
CURRENT_MONTH=$(date -u +%m)

# Consolidate either when threshold met or new year starts
if (( MONTHLY_COUNT >= YEARLY_THRESHOLD )) || { (( MONTHLY_COUNT > 0 )) && (( CURRENT_MONTH == 01 )); }; then
  echo "Consolidating $MONTHLY_COUNT monthly archives into a yearly archive..."
  
  if ! ia configure --whoami >/dev/null 2>&1; then
    echo "Internet Archive 'ia' CLI not configured."

    if [[ -z "${IA_EMAIL:-}" || -z "${IA_PASSWORD:-}" ]]; then
      echo "Missing credentials. Set IA_EMAIL and IA_PASSWORD environment variables or run 'ia configure' manually."
      exit 1
    fi

    echo "Configuring 'ia' CLI with provided credentials..."
    if ! ia configure --email "$IA_EMAIL" --password "$IA_PASSWORD"; then
      echo "'ia' CLI configuration failed. Aborting yearly consolidation."
      exit 1
    fi

    echo "Verifying 'ia' CLI configuration..."
    if ! ia configure --whoami >/dev/null 2>&1; then
      echo "'ia' CLI configuration verification failed. Aborting yearly consolidation."
      exit 1
    fi

    echo "'ia' CLI configured successfully."
  fi

  readarray -t MONTHLY_LIST < <(jq -r '.monthly[]' "$MANIFEST")
  FIRST="${MONTHLY_LIST[0]}"
  LAST="${MONTHLY_LIST[-1]}"
  START=$(echo "$FIRST" | grep -oE '[0-9]+' | tail -2 | head -1)
  END=$(echo "$LAST" | grep -oE '[0-9]+' | tail -1)

  TIMESTAMP="$(date -u +%Y%m%d%H%M%S)"
  YEARLY="${TIMESTAMP}_yearly_${START}_${END}"
  YEARLY_FILE="${YEARLY}.ndjson"
  YEARLY_GZ="${YEARLY_FILE}.gz"
  >"$YEARLY_FILE"

  # If triggered in January, label using the *previous* year
  if (( CURRENT_MONTH == 01 )); then
    DATE_LABEL=$(date -u -d "last year" +%Y)
  else
    DATE_LABEL=$(date -u +%Y)
  fi

  echo "Combining monthly archives for the ${DATE_LABEL} cycle..."
  for M in "${MONTHLY_LIST[@]}"; do
    GZ="${M}.ndjson.gz"
    [[ -f "$GZ" ]] || gh release download "$M" -p "$GZ"
    gzip -dc "$GZ" >>"$YEARLY_FILE"
  done

  echo "Rechecking yearly archive file..."
  if ! node reCheck.js "$YEARLY_FILE"; then
    echo "reCheck failed. Continuing with rechecked data."
  fi

  echo "Compressing yearly archive..."
  gzip -9 -c "$YEARLY_FILE" >"$YEARLY_GZ"

  IA_ID="${IA_PREFIX}_${START}_${END}_$(date -u +%Y%m%d%H%M%S)"
  echo "Uploading yearly archive to Internet Archive..."
  ia upload "$IA_ID" "$YEARLY_GZ" \
    --metadata="collection:${IA_COLLECTION}" \
    --metadata="title:${DATE_LABEL} /mlp/ yearly archive covering posts ${START}-${END}" \
    --metadata="subject:${IA_SUBJECTS}" \
    --metadata="mediatype:data" \
    --metadata="creator:${IA_CREATOR}"

  IA_URL="https://archive.org/download/${IA_ID}/$(basename "$YEARLY_GZ")"

  jq --arg name "$YEARLY" --arg url "$IA_URL" \
    '.monthly = [] | .yearly += [{"name":$name,"url":$url}]' \
    "$MANIFEST" >tmp && mv tmp "$MANIFEST"

  echo "Committing updated manifest..."
  commit_and_tag "$YEARLY"

  echo "Removing old monthly releases..."
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