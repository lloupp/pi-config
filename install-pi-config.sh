#!/bin/bash
# install-pi-config.sh - Install Pi coding agent config in a new environment
# Usage: bash install-pi-config.sh [--global|--project] [source_dir]

set -euo pipefail

MODE="${1:---global}"
SRC_DIR="${2:-$HOME/pi-config}"

# Only config items are installed; repo-only files (README, .git, this script) stay out.
ITEMS=(AGENTS.md settings.json prompts skills extensions themes)

case "$MODE" in
  --project|project)
    DEST_DIR=".pi/agent"
    ;;
  --global|global)
    DEST_DIR="$HOME/.pi/agent"
    ;;
  *)
    echo "Uso: bash install-pi-config.sh [--global|--project] [source_dir]" >&2
    exit 1
    ;;
esac

if [[ ! -d "$SRC_DIR" ]]; then
  echo "Erro: diretório de origem $SRC_DIR não encontrado." >&2
  echo "Esperava encontrar o backup do pi-config lá." >&2
  exit 1
fi

echo "Instalando Pi config de $SRC_DIR em $DEST_DIR"
mkdir -p "$DEST_DIR"

for item in "${ITEMS[@]}"; do
  if [[ -e "$SRC_DIR/$item" ]]; then
    cp -r "$SRC_DIR/$item" "$DEST_DIR/"
    echo "  ✓ $item"
  else
    echo "  - $item não encontrado em $SRC_DIR; pulando." >&2
  fi
done

echo "Pronto. Reinicie o Pi ou use /reload-pi para aplicar."
