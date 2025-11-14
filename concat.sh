#!/bin/bash
# concat.sh - Concatenate binary files into a single output file, with progress for large files
# Usage: ./concat.sh part1.bin part2.bin ... output.bin

set -e

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 input1 input2 [...inputN] output_file"
  exit 1
fi

output_file="${@: -1}"
input_files=("${@:1:$#-1}")

# 100 MB threshold in bytes
threshold=$((100 * 1024 * 1024))

: > "$output_file"

for f in "${input_files[@]}"; do
  if [ ! -f "$f" ]; then
    echo "Error: Input file '$f' not found!"
    exit 1
  fi

  size=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f")

  echo "Processing $f ($((size / 1024 / 1024)) MB)..."

  if [ "$size" -gt "$threshold" ] && command -v pv >/dev/null 2>&1; then
    echo "  Using pv for progress..."
    pv "$f" >> "$output_file"
  else
    cat "$f" >> "$output_file"
  fi
done

echo "✅ Done! Created $output_file"