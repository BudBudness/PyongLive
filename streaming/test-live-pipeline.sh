#!/usr/bin/env bash
set -euo pipefail

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
password="$(openssl rand -hex 16)"
path="event-$(openssl rand -hex 16)-$(openssl rand -hex 16)"
container="pyonglive-mediamtx-ci"
media_pid=""
ffmpeg_pid=""

cleanup() {
  if [[ -n "$ffmpeg_pid" ]]; then kill "$ffmpeg_pid" 2>/dev/null || true; wait "$ffmpeg_pid" 2>/dev/null || true; fi
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

sed "s/REPLACE_WITH_A_LONG_RANDOM_PASSWORD/$password/g" "$root/mediamtx.yml" > "$tmp/mediamtx.yml"
mkdir -p "$tmp/recordings"

docker run --rm --network host --name "$container" \
  -v "$tmp/mediamtx.yml:/mediamtx.yml:ro" \
  -v "$tmp/recordings:/recordings" \
  bluenviron/mediamtx:1 >"$tmp/mediamtx.log" 2>&1 &
media_pid=$!

ready=0
for _ in $(seq 1 50); do
  if ! kill -0 "$media_pid" 2>/dev/null; then
    cat "$tmp/mediamtx.log"
    echo "MediaMTX exited before becoming ready" >&2
    exit 1
  fi
  if curl -fsS --max-time 1 "http://127.0.0.1:8888/" >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.2
done
if [[ "$ready" != 1 ]]; then cat "$tmp/mediamtx.log"; echo "MediaMTX did not become ready" >&2; exit 1; fi

ffmpeg -hide_banner -loglevel error -re \
  -f lavfi -i "testsrc2=size=320x240:rate=10" -t 8 \
  -an -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 10 -f flv \
  "rtmp://publisher:$password@127.0.0.1:1935/$path" >"$tmp/ffmpeg.log" 2>&1 &
ffmpeg_pid=$!

hls_ready=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 "http://127.0.0.1:8888/$path/index.m3u8" -o "$tmp/index.m3u8" 2>/dev/null && grep -q '#EXTM3U' "$tmp/index.m3u8"; then
    hls_ready=1
    break
  fi
  if ! kill -0 "$ffmpeg_pid" 2>/dev/null; then break; fi
  sleep 0.25
done
if [[ "$hls_ready" != 1 ]]; then
  cat "$tmp/ffmpeg.log" || true
  cat "$tmp/mediamtx.log"
  echo "Live HLS playlist was not available" >&2
  exit 1
fi
wait "$ffmpeg_pid"
ffmpeg_pid=""

recording=""
for _ in $(seq 1 40); do
  recording="$(find "$tmp/recordings/$path" -type f -name '*.mp4' -size +0c -print -quit 2>/dev/null || true)"
  [[ -n "$recording" ]] && break
  sleep 0.25
done
if [[ -z "$recording" ]]; then
  cat "$tmp/mediamtx.log"
  echo "MediaMTX did not produce an MP4 recording" >&2
  exit 1
fi

echo "PASS: authenticated RTMP publish produced an HLS playlist and a non-empty MP4 recording."
