#!/bin/sh
# Checks that the ffmpeg in an api image can make and read every audio format
# the server converts to. Usage: apps/server/scripts/verify-image-ffmpeg.sh <image>
# It encodes a one-second sine tone per extension the way `convertAudio` does
# (libmp3lame for mp3, encoder defaults otherwise), then decodes each file with
# `inputGuards()` plus `DECODE_ARGS_TAIL` from src/lib/media.ts, all as `bun`.
set -eu

image="${1:?usage: verify-image-ffmpeg.sh <image>}"

docker run --rm --user bun --entrypoint sh "$image" -c '
  set -eu
  ffmpeg -version | head -n 1
  if ffmpeg -buildconf | grep -q -- --enable-nonfree; then
    echo "nonfree build" >&2
    exit 1
  fi
  dir=$(mktemp -d)
  for ext in wav mp3 aiff flac m4a aac ogg; do
    codec=""
    [ "$ext" = mp3 ] && codec="-c:a libmp3lame"
    ffmpeg -hide_banner -nostats -loglevel error -y \
      -f lavfi -i "sine=frequency=440:duration=1" $codec "$dir/tone.$ext"
    ffmpeg -hide_banner -nostats -loglevel error \
      -protocol_whitelist file,pipe -t 21600 -i "$dir/tone.$ext" \
      -vn -f f32le -ac 2 -ar 48000 - >"$dir/tone.$ext.pcm"
    echo "$ext ok ($(wc -c <"$dir/tone.$ext.pcm") pcm bytes)"
  done
'
