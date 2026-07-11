#!/usr/bin/env bash
set -euo pipefail

# deploy-omo.sh — Build and deploy the omo-stable plugin
#
# opencode loads the plugin via file:// from (see ~/.opencode/opencode.json):
#   ~/.cache/opencode/node_modules/omo-stable/dist/index.js   (ACTIVE)
#
# The legacy omo-fork path is also updated for safety:
#   ~/.cache/opencode/node_modules/omo-fork/dist/index.js
#
# Usage:
#   ./script/deploy-omo.sh             # Build (Docker) + deploy
#   ./script/deploy-omo.sh --no-build  # Deploy existing dist/index.js only
#
# Environment variables:
#   OMO_STABLE_TARGET  — override active install path (default: ~/.cache/opencode/node_modules/omo-stable/dist)
#   OMO_FORK_TARGET    — override legacy install path (default: ~/.cache/opencode/node_modules/omo-fork/dist)

# Project root = parent of this script's directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OMO_SOURCE="$(cd "$SCRIPT_DIR/.." && pwd)"

OMO_STABLE_TARGET="${OMO_STABLE_TARGET:-$HOME/.cache/opencode/node_modules/omo-stable/dist}"
OMO_FORK_TARGET="${OMO_FORK_TARGET:-$HOME/.cache/opencode/node_modules/omo-fork/dist}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { printf "${YELLOW}▶${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$*"; }
die()   { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

[[ -f "$OMO_SOURCE/src/index.ts" ]] || die "Not the omo-stable repo: $OMO_SOURCE/src/index.ts missing"

BUILD=1
[[ "${1:-}" == "--no-build" ]] && BUILD=0

# --- Build ---
if [[ $BUILD -eq 1 ]]; then
  info "Building via Docker (oven/bun:latest)..."
  sg docker -c "docker run --rm -v $OMO_SOURCE:/app -w /app oven/bun:latest \
    bash -c 'bun install && bun build src/index.ts --outdir dist --target bun --format esm --external @ast-grep/napi'" \
    || die "Docker build failed (are you in the 'docker' group?)"
  ok "Build complete"
fi

ARTIFACT="$OMO_SOURCE/dist/index.js"
[[ -f "$ARTIFACT" ]] || die "Build artifact missing: $ARTIFACT (run without --no-build)"

# --- Deploy (with timestamped backup) ---
STAMP=$(date +%Y%m%d-%H%M%S)
deploy_to() {
  local target_dir="$1" name="$2"
  mkdir -p "$target_dir"
  if [[ -f "$target_dir/index.js" ]]; then
    cp "$target_dir/index.js" "$target_dir/index.js.bak.$STAMP"
  fi
  cp "$ARTIFACT" "$target_dir/index.js"
  ok "Deployed to $name: $target_dir/index.js"
}

info "Deploying..."
deploy_to "$OMO_STABLE_TARGET" "omo-stable (ACTIVE)"
deploy_to "$OMO_FORK_TARGET"   "omo-fork (legacy)"

# --- Verify checksums all match ---
info "Verifying checksums..."
SRC_HASH=$(sha256sum "$ARTIFACT" | awk '{print $1}')
STABLE_HASH=$(sha256sum "$OMO_STABLE_TARGET/index.js" | awk '{print $1}')
FORK_HASH=$(sha256sum "$OMO_FORK_TARGET/index.js" | awk '{print $1}')

printf "  source:     %s\n" "$SRC_HASH"
printf "  omo-stable: %s\n" "$STABLE_HASH"
printf "  omo-fork:   %s\n" "$FORK_HASH"

[[ "$SRC_HASH" == "$STABLE_HASH" ]] || die "omo-stable checksum mismatch"
[[ "$SRC_HASH" == "$FORK_HASH" ]]   || die "omo-fork checksum mismatch"
ok "All checksums match"

SIZE=$(du -h "$ARTIFACT" | awk '{print $1}')
ok "Done. Artifact size: $SIZE"
printf "${GREEN}Restart opencode to load the new plugin.${NC}\n"
