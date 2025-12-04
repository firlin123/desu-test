#!/usr/bin/env bash
set -euo pipefail

# ==============================
# Configuration and Setup
# ==============================

REPO="${REPO:-firlin123/desuarchive-mlp-backup}"
LOCAL_FILE="desuarchive_mlp_full.ndjson"
ATTEMPT_REPAIR=0

# ==============================
# Argument Parsing
# ==============================

while [[ $# -gt 0 ]]; do
    case "$1" in
        -r|--attempt-repair)
            ATTEMPT_REPAIR=1
            shift
            ;;
        -*)
            echo "Usage: $0 [-r|--attempt-repair] [<local-ndjson-file>]" >&2
            exit 1
            ;;
        *)
            LOCAL_FILE="$1"
            shift
            ;;
    esac
done

LOCAL_DIR="$(dirname "$LOCAL_FILE")"
BASE="https://github.com/$REPO/releases/download"
MANIFEST_URL="https://raw.githubusercontent.com/${REPO}/main/manifest.json"

# ==============================
# Dependency Check
# ==============================
REQUIRED_CMDS=(curl jq parallel gzip dd stat tail)

if [[ $ATTEMPT_REPAIR -eq 1 ]]; then
    REQUIRED_CMDS+=(truncate)
fi

MISSING=()
for cmd in "${REQUIRED_CMDS[@]}"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        MISSING+=("$cmd")
    fi
done

if [ ${#MISSING[@]} -ne 0 ]; then
    echo "Error: Missing required commands: ${MISSING[*]}" >&2
    exit 1
fi

# ==============================
# Download Manifest
# ==============================
if ! MANIFEST="$(curl -fsSL "$MANIFEST_URL")"; then
    echo "Failed to download manifest.json from ${MANIFEST_URL}" >&2
    exit 1
fi

if ! LAST_REMOTE="$(jq -r '.lastDownloaded' <<<"$MANIFEST" 2>/dev/null)"; then
    echo "Downloaded manifest.json is invalid." >&2
    exit 1
fi

# ==============================
# Check Local Archive State
# ==============================
LAST_LOCAL=0
if [[ -f "$LOCAL_FILE" ]]; then
    if ! LAST_LOCAL_JSON="$(tail -n 1 "$LOCAL_FILE" 2>/dev/null)"; then
        echo "Failed to read local NDJSON file." >&2
        exit 1
    fi
    if ! LAST_LOCAL="$(jq -r '.num' <<<"$LAST_LOCAL_JSON" 2>/dev/null)"; then
        if [[ $ATTEMPT_REPAIR -eq 0 ]]; then
            echo "Failed to parse local NDJSON file. If the process was interrupted, consider using the --attempt-repair (-r) to remove the last corrupted line." >&2
            exit 1
        fi
        echo "Attempting to repair local NDJSON file by removing the last line..." >&2
        LAST_LINE_LEN=$(wc -c < <(echo -n "$LAST_LOCAL_JSON"))
        FILE_SIZE=$(stat -c%s "$LOCAL_FILE")
        TRUNC_SIZE=$(( FILE_SIZE - LAST_LINE_LEN ))
        if (( TRUNC_SIZE < 0 )); then
            echo "Error: Cannot repair file; it may be too small or empty." >&2
            exit 1
        fi
        echo "Truncating file to $TRUNC_SIZE bytes..." >&2
        truncate --size=$TRUNC_SIZE "$LOCAL_FILE"
        exit 0
    fi
fi

# Define update range
UD_START=$((LAST_LOCAL + 1))
UD_END="$LAST_REMOTE"

# ==============================
# Check for No Updates
# ==============================
if [[ $UD_START -gt $UD_END ]]; then
    echo "Local archive is already up to date. No updates needed." >&2
    exit 0
fi

# ==============================
# Parse Names and URLs from Manifest
# ==============================
readarray -t NAMES < <(jq -r '((.yearly | map(.name)) + .monthly + .daily)[]' <<<"$MANIFEST" 2>/dev/null)
readarray -t LINKS < <(jq -r --arg base "$BASE" '((.yearly | map(.url)) + [(.monthly + .daily)[] | "\($base)/\(.)/\(.).ndjson.gz"])[]' <<<"$MANIFEST" 2>/dev/null)

# Arrays for temporary download and extract tracking
NAMES_TD=()
LINKS_TD=()
STARTS_TD=()
ENDS_TD=()
PATHS_TD=()
GZ_PATHS_TD=()

# Ensure temp files get cleaned up on exit
trap 'rm -f "${GZ_PATHS_TD[@]}" "${PATHS_TD[@]}"' EXIT

# ==============================
# Validate Contiguity and Queue Needed Files
# ==============================
PREV_END=-1
for i in "${!NAMES[@]}"; do
    NAME="${NAMES[i]}"
    LINK="${LINKS[i]}"

    # Extract start/end post numbers from filenames
    if [[ "$NAME" =~ _([0-9]+)_([0-9]+)$ ]]; then
        START="${BASH_REMATCH[1]}"
        END="${BASH_REMATCH[2]}"
    else
        echo "Error: Invalid entry name '$NAME'." >&2
        exit 1
    fi

    # Ensure no gaps between chunks
    if [[ $PREV_END -ne -1 && $((PREV_END + 1)) -ne $START ]]; then
        echo "Error: Gap detected between entries $PREV_END and $START." >&2
        exit 1
    fi
    PREV_END=$END

    # Include only newer chunks
    if (( END >= UD_START )); then
        NAMES_TD+=("$NAME")
        LINKS_TD+=("$LINK")
        STARTS_TD+=("$START")
        ENDS_TD+=("$END")
        GZ_PATHS_TD+=("$(mktemp "${LOCAL_DIR}/$NAME.ndjson.gz.tmp.XXXXXX")")
        PATHS_TD+=("$(mktemp "${LOCAL_DIR}/$NAME.ndjson.tmp.XXXXXX")")
    fi
done

# ==============================
# Parallel Download of Needed Files
# ==============================
if parallel -j 8 --halt now,fail=1 --ungroup --no-notice --plain '
    echo "Downloading "{1}"..."
    if ! curl -fsSL {2} -o {3} 2>&1; then
        echo "Failed to download "{1}"."
        exit 1
    fi
    echo "Done downloading "{1}"."
' ::: "${NAMES_TD[@]}" :::+ "${LINKS_TD[@]}" :::+ "${GZ_PATHS_TD[@]}" >&2 2>/dev/null; then
    echo "All downloads completed successfully." >&2
else
    echo "One or more downloads failed." >&2
    exit 1
fi

# ==============================
# Parallel Decompression
# ==============================
CORES=$(nproc || echo 4)
if parallel -j "$CORES" --halt now,fail=1 --ungroup --no-notice --plain '
    echo "Decompressing "{1}"..."
    if ! gzip -dc {2} > {3} 2>/dev/null; then
        echo "Failed to decompress "{1}"."
        exit 1
    fi
    echo "Done decompressing "{1}"."
    rm -f {2}
' ::: "${NAMES_TD[@]}" :::+ "${GZ_PATHS_TD[@]}" :::+ "${PATHS_TD[@]}" >&2 2>/dev/null; then
    echo "All decompressions completed successfully." >&2
else
    echo "One or more decompressions failed." >&2
    exit 1
fi

# ==============================
# Partial Trim (If Local Mid-Chunk)
# ==============================
if [[ "${STARTS_TD[0]}" -ne "$UD_START" ]]; then
    REMOTE_NAME="${NAMES_TD[0]}"
    REMOTE_START="${STARTS_TD[0]}"
    REMOTE_END="${ENDS_TD[0]}"
    REMOTE_PATH="${PATHS_TD[0]}"

    echo "Trimming ${REMOTE_NAME} to start from post ${UD_START}..." >&2

    # Adjust metadata
    REMOTE_SUFFIX="_${REMOTE_START}_${REMOTE_END}"
    NEW_SUFFIX="_${UD_START}_${ENDS_TD[0]}"
    NEW_NAME="${REMOTE_NAME%$REMOTE_SUFFIX}$NEW_SUFFIX"
    NEW_START="$UD_START"
    NEW_END="${REMOTE_END}"
    NEW_PATH="$(mktemp "${LOCAL_DIR}/$NEW_NAME.ndjson.tmp.XXXXXX")"
    PATHS_TD+=("$NEW_PATH")

    # Binary-search setup
    MAX_SEARCH=1048576
    BUF_SIZE=65536
    SEPARATOR=$'\n'
    LC_ALL=C
    REMOTE_SIZE=$(stat -c%s "$REMOTE_PATH")
    LOW=0
    HIGH=$REMOTE_SIZE
    FOUND_OBJ_START=-1
    FOUND_OBJ_END=-1

    # Locate byte offset where post.num == UD_START
    while [[ $LOW -le $HIGH ]]; do
        MID=$(( (LOW + HIGH) / 2 ))
        BYTES_READ=0
        LINE_START=-1
        LINE_END=-1
        READ_POS=$MID

        # Search backward for start of line
        while (( READ_POS > 0 && LINE_START == -1 )); do
            if (( READ_POS < BUF_SIZE )); then
                READ_START=0
            else
                READ_START=$(( READ_POS - BUF_SIZE ))
            fi
            TO_READ=$(( READ_POS - READ_START ))
            CHUNK="$(dd if="$REMOTE_PATH" bs=64K iflag=skip_bytes,count_bytes skip=$READ_START count=$TO_READ 2>/dev/null)"
            CHUNK_SIZE=${#CHUNK}
            BYTES_READ=$(( BYTES_READ + CHUNK_SIZE ))
            if (( BYTES_READ > MAX_SEARCH )); then
                echo "Error: Reached maximum search limit without finding line start." >&2
                exit 1
            fi
            REMAINING_CHUNK="${CHUNK%$SEPARATOR*}"
            if [[ "$REMAINING_CHUNK" != "$CHUNK" ]]; then
                LINE_START=$(( READ_START + ${#REMAINING_CHUNK} + 1 ))
                break
            fi
            READ_POS=$READ_START
        done
        (( LINE_START == -1 )) && LINE_START=0

        # Search forward for end of line
        READ_POS=$MID
        while (( READ_POS < REMOTE_SIZE && LINE_END == -1 )); do
            TO_READ_MAX=$(( REMOTE_SIZE - READ_POS ))
            TO_READ=$BUF_SIZE
            (( TO_READ > TO_READ_MAX )) && TO_READ=$TO_READ_MAX

            CHUNK="$(dd if="$REMOTE_PATH" bs=64K iflag=skip_bytes,count_bytes skip=$READ_POS count=$TO_READ 2>/dev/null)"
            CHUNK_SIZE=${#CHUNK}
            BYTES_READ=$(( BYTES_READ + CHUNK_SIZE ))
            if (( BYTES_READ > MAX_SEARCH )); then
                echo "Error: Reached maximum search limit without finding line end." >&2
                exit 1
            fi
            REMAINING_CHUNK="${CHUNK#*$SEPARATOR}"
            if [[ "$REMAINING_CHUNK" != "$CHUNK" ]]; then
                LINE_END=$(( READ_POS + CHUNK_SIZE - ${#REMAINING_CHUNK} - 1 ))
                break
            fi
            READ_POS=$(( READ_POS + BUF_SIZE ))
        done
        (( LINE_END == -1 )) && LINE_END=$REMOTE_SIZE

        if (( LINE_START >= LINE_END )); then
            echo "Error: Failed to determine line boundaries during binary search." >&2
            exit 1
        fi

        LINE_BYTES=$(( LINE_END - LINE_START ))
        if (( LINE_BYTES >= MAX_SEARCH )); then
            echo "Error: Line size exceeds maximum search limit." >&2
            exit 1
        fi
        LINE_JSON="$(dd if="$REMOTE_PATH" bs="$LINE_BYTES"B iflag=skip_bytes skip=$LINE_START count=1 2>/dev/null)"
        if ! LINE_NUM=$(jq -r '.num' <<<"$LINE_JSON" 2>/dev/null); then
            echo "Error: Failed to parse post JSON during binary search." >&2
            exit 1
        fi

        if (( LINE_NUM < UD_START )); then
            # echo "[DEBUG] $LINE_NUM < $UD_START" >&2
            LOW=$(( LINE_END + 1 ))
        elif (( LINE_NUM > UD_START )); then
            # echo "[DEBUG] $LINE_NUM > $UD_START" >&2
            HIGH=$(( LINE_START - 1 ))
        else
            # echo "[DEBUG] $LINE_NUM == $UD_START" >&2
            FOUND_OBJ_START=$LINE_START
            FOUND_OBJ_END=$LINE_END
            break
        fi
    done
    unset LC_ALL

    if (( FOUND_OBJ_START == -1 || FOUND_OBJ_END == -1 )); then
        echo "Error: Failed to locate post ${UD_START} in remote file." >&2
        exit 1
    fi

    echo "Overwriting ${REMOTE_NAME} to start from post ${UD_START} at byte offset ${FOUND_OBJ_START}..." >&2
    dd if="$REMOTE_PATH" bs=16M iflag=skip_bytes skip=$FOUND_OBJ_START of="$NEW_PATH" 2>/dev/null

    rm -f "$REMOTE_PATH"
    unset 'PATHS_TD[-1]'
    NAMES_TD[0]="$NEW_NAME"
    STARTS_TD[0]="$NEW_START"
    ENDS_TD[0]="$NEW_END"
    PATHS_TD[0]="$NEW_PATH"

    echo "Trim complete." >&2
fi

# ==============================
# Append Updates to Local Archive
# ==============================
for i in "${!NAMES_TD[@]}"; do
    REMOTE_NAME="${NAMES_TD[i]}"
    REMOTE_START="${STARTS_TD[i]}"
    REMOTE_END="${ENDS_TD[i]}"
    REMOTE_PATH="${PATHS_TD[i]}"
    echo "Appending posts ${REMOTE_START}–${REMOTE_END} from ${REMOTE_NAME}..." >&2
    cat "$REMOTE_PATH" >> "$LOCAL_FILE"
    rm -f "$REMOTE_PATH"
done

echo "Updated posts from ${UD_START} to ${UD_END} appended to ${LOCAL_FILE}." >&2
