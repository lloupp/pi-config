#!/bin/bash
# install-pi-config.sh - Install Pi coding agent config in a new environment
# Usage: bash install-pi-config.sh [--global|--project] [source_dir]

set -euo pipefail

MODE="${1:-global}"
SRC_DIR="${2:-$HOME/pi-config}"

if [[ "$MODE" == "--project" ]]; then
  DEST_DIR=".pi/agent"
  CMD="mkdir -p .pi/agent && cp -r \"$SRC_DIR\"/* \"$DEST_DIR/\" && echo 'Config installed to .pi/agent/'"
else
  DEST_DIR="$HOME/.pi/agent"
  CMD="mkdir -p \"\$HOME/.pi/agent\" && cp -r \"$SRC_DIR\"/* \"\$HOME/.pi/agent/\" && echo 'Config installed to ~/.pi/agent/'"
fi

# Safety: warn if source does not exist
if [[ ! -d "$SRC_DIR" ]]; then
  echo "Warning: Source directory $SRC_DIR not found."
  echo "Expected to find pi-config backup there."
  exit 1
fi

echo "Installing Pi config from $SRC_DIR to $DEST_DIR"
eval "$CMD"

echo "Done. Restart or reload Pi to apply."