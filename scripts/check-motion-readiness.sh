#!/bin/sh
set -eu

page=${1:-index.html}

grep -q '<canvas class="motion-decoder" id="girlMotion"' "$page"
grep -q '<canvas class="motion-decoder" id="boyMotion"' "$page"
grep -q 'frameCount=52' "$page"
grep -q 'context.drawImage(image,0,0)' "$page"

if grep -q 'fetch(video.currentSrc||video.src)' "$page" || grep -q 'URL.createObjectURL' "$page"; then
  echo "motion videos still duplicate full files into memory" >&2
  exit 1
fi

if grep -q 'Math.abs(video.currentTime-target)>.016' "$page"; then
  echo "the scroll animation still performs random video seeks" >&2
  exit 1
fi

if grep -q 'mask-composite:intersect' "$page"; then
  echo "the Safari-inconsistent multi-mask composite is still present" >&2
  exit 1
fi

for person in girl boy; do
  count=$(find "assets/motion/$person" -type f -name 'frame-*.jpg' | wc -l | tr -d ' ')
  [ "$count" = 52 ] || {
    echo "assets/motion/$person has $count frames instead of 52" >&2
    exit 1
  }
done

echo "motion video readiness checks passed"
