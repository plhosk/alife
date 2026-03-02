#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:4173/}"
PROFILE_ROOT="${2:-/tmp/alife-shards-12d}"
START_STAGGER_SEC="${3:-2}"

declare -a SHARDS=(
  "ecosystem-axes-sobol-12d-shard-a"
  "ecosystem-axes-sobol-12d-shard-b"
  "ecosystem-axes-sobol-12d-shard-c"
  "ecosystem-axes-sobol-12d-shard-d"
  "ecosystem-axes-sobol-12d-shard-e"
  "ecosystem-axes-sobol-12d-shard-f"
)

if ! command -v chromium >/dev/null 2>&1; then
  echo "chromium command not found"
  exit 1
fi

mkdir -p "$PROFILE_ROOT"

for i in "${!SHARDS[@]}"; do
  shard="${SHARDS[$i]}"
  profile_dir="$PROFILE_ROOT/profile$((i + 1))"
  delay_ms=2000
  url="${BASE_URL}?automationPreset=${shard}&automationAutoStart=1&automationDelayMs=${delay_ms}"

  mkdir -p "$profile_dir"

  chromium --user-data-dir="$profile_dir" "$url" >/dev/null 2>&1 &

  echo "Started shard $((i + 1)) (${shard})"
  echo "  profile: $profile_dir"
  echo "  url: $url"

  sleep "$START_STAGGER_SEC"
done

echo "All shard windows launched in background."
