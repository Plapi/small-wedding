#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-/Users/adrianplapamaru/Downloads/Cununie/Selectate}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$PROJECT_DIR/frontend/public/invite-photos"
TEMP_DIR="$PROJECT_DIR/.tmp-invite-photos"
MAX_SIZE=1600
QUALITY=78

mkdir -p "$OUTPUT_DIR" "$TEMP_DIR"
rm -f "$OUTPUT_DIR"/photo-*.webp "$OUTPUT_DIR/photos.json"
rm -f "$TEMP_DIR"/*

index=0
manifest="["

while IFS= read -r source_file; do
  output_name="$(printf "photo-%02d.webp" "$index")"
  output_file="$OUTPUT_DIR/$output_name"
  extension="${source_file##*.}"
  extension="$(printf "%s" "$extension" | tr "[:upper:]" "[:lower:]")"

  if [[ "$extension" == "heic" ]]; then
    qlmanage -t -s "$MAX_SIZE" -o "$TEMP_DIR" "$source_file" >/dev/null 2>&1
    thumbnail_file="$TEMP_DIR/$(basename "$source_file").png"
    cwebp -quiet -q "$QUALITY" "$thumbnail_file" -o "$output_file"
  else
    ffmpeg -hide_banner -loglevel error -noautorotate -i "$source_file" \
      -vf "scale='if(gt(iw,ih),$MAX_SIZE,-2)':'if(gt(iw,ih),-2,$MAX_SIZE)'" \
      -frames:v 1 -c:v libwebp -quality "$QUALITY" "$output_file" -y
  fi

  if [[ "$index" -gt 0 ]]; then
    manifest="$manifest,"
  fi
  manifest="$manifest\"/invite-photos/$output_name\""

  index=$((index + 1))
done < <(find "$SOURCE_DIR" -maxdepth 1 -type f \( -iname "*.heic" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" \) -print | sort -V)

manifest="$manifest]"
printf "%s\n" "$manifest" > "$OUTPUT_DIR/photos.json"

echo "Optimized $index photos into $OUTPUT_DIR"
