#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p build
temporary_icon="$(mktemp build/icon.XXXXXX)"
trap 'rm -f "$temporary_icon"' EXIT

icon_url="https://cdn.quo.com/favicon/android-chrome-512x512.png"
expected_sha256="2584360fb01a1e064f7d5143c064f98bf94f2338d3ccb49f8c6f2399d2789f30"
curl \
  --connect-timeout 10 \
  --fail \
  --location \
  --max-time 60 \
  --proto '=https' \
  --retry 3 \
  --retry-all-errors \
  --show-error \
  --silent \
  --tlsv1.2 \
  "$icon_url" \
  --output "$temporary_icon"

if command -v sha256sum >/dev/null 2>&1; then
  actual_sha256="$(sha256sum "$temporary_icon" | awk '{print $1}')"
else
  actual_sha256="$(shasum -a 256 "$temporary_icon" | awk '{print $1}')"
fi

if [[ "$actual_sha256" != "$expected_sha256" ]]; then
  echo "Icon checksum mismatch" >&2
  exit 1
fi

chmod 0644 "$temporary_icon"
mv "$temporary_icon" build/icon.png
echo "Fetched verified icon to build/icon.png"
