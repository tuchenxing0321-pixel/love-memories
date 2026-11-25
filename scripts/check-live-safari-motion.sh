#!/bin/sh
set -eu

url=${1:-https://love-memories-memories-d4g4tuz0rd39f03f2.webapps.tcloudbase.com/}
page=$(mktemp)
trap 'rm -f "$page"' EXIT

curl -fsSL "$url" -o "$page"

fail() {
  echo "Safari compatibility check failed: $1" >&2
  exit 1
}

grep -q '<canvas class="motion-decoder" id="girlMotion"' "$page" || fail 'CloudBase is still serving the old girl motion video'
grep -q '<canvas class="motion-decoder" id="boyMotion"' "$page" || fail 'CloudBase is still serving the old boy motion video'
grep -q 'frameCount=52' "$page" || fail 'CloudBase is not serving the Canvas frame sequence'

if grep -q 'URL.createObjectURL' "$page"; then
  fail 'CloudBase still duplicates both videos into Blob memory'
fi

if grep -q 'Math.abs(video.currentTime-target)>.016' "$page"; then
  fail 'CloudBase still performs random video seeks'
fi

if grep -q 'mask-composite:intersect' "$page"; then
  fail 'CloudBase still uses the Safari-inconsistent multi-mask composite'
fi

echo 'CloudBase Safari motion checks passed'
