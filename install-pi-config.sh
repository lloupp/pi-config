#!/bin/bash
# install-pi-config.sh - Install Pi coding agent config in a new environment
# Usage: bash install-pi-config.sh [--global|--project] [source_dir]

set -euo pipefail

MODE="${1:---global}"
SRC_DIR="${2:-$HOME/pi-config}"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "Erro: diretório de origem $SRC_DIR não encontrado." >&2
  echo "Esperava encontrar o backup do pi-config lá." >&2
  exit 1
fi

SRC_DIR="$(cd "$SRC_DIR" && pwd -P)"

mirror_dir() {
  local src="$1"
  local dest="$2"
  local label="$3"

  if [[ ! -d "$src" ]]; then
    echo "  - $label não encontrado em $SRC_DIR; pulando." >&2
    return
  fi

  # Espelha em vez de mesclar: recurso removido da origem não pode continuar ativo
  # silenciosamente no destino.
  rm -rf "${dest:?}"
  mkdir -p "$(dirname "$dest")"
  cp -r "$src" "$dest"
  echo "  ✓ $label"
}

copy_file() {
  local src="$1"
  local dest="$2"
  local label="$3"

  if [[ ! -f "$src" ]]; then
    echo "  - $label não encontrado em $SRC_DIR; pulando." >&2
    return
  fi

  mkdir -p "$(dirname "$dest")"

  # Em --project, a origem pode ser o próprio projeto atual. Nesse caso AGENTS.md já
  # está exatamente no destino e `cp` recusaria copiar o arquivo sobre ele mesmo.
  if [[ "$src" != "$dest" ]]; then
    cp "$src" "$dest"
  fi
  echo "  ✓ $label"
}

case "$MODE" in
  --global|global)
    DEST_DIR="$HOME/.pi/agent"
    echo "Instalando Pi config global de $SRC_DIR em $DEST_DIR"
    mkdir -p "$DEST_DIR"

    copy_file "$SRC_DIR/AGENTS.md" "$DEST_DIR/AGENTS.md" "AGENTS.md"
    mirror_dir "$SRC_DIR/prompts" "$DEST_DIR/prompts" "prompts"
    mirror_dir "$SRC_DIR/skills" "$DEST_DIR/skills" "skills"
    mirror_dir "$SRC_DIR/extensions" "$DEST_DIR/extensions" "extensions"
    ;;

  --project|project)
    PROJECT_ROOT="$(pwd -P)"
    PI_DIR="$PROJECT_ROOT/.pi"
    echo "Instalando Pi config de projeto de $SRC_DIR em $PROJECT_ROOT"
    mkdir -p "$PI_DIR"

    # O DefaultResourceLoader do Pi procura contexto em <projeto>/AGENTS.md e os demais
    # recursos em <projeto>/.pi/{prompts,skills,extensions}. `.pi/agent` não é um local
    # de descoberta de recursos de projeto.
    copy_file "$SRC_DIR/AGENTS.md" "$PROJECT_ROOT/AGENTS.md" "AGENTS.md"
    mirror_dir "$SRC_DIR/prompts" "$PI_DIR/prompts" ".pi/prompts"
    mirror_dir "$SRC_DIR/skills" "$PI_DIR/skills" ".pi/skills"
    mirror_dir "$SRC_DIR/extensions" "$PI_DIR/extensions" ".pi/extensions"
    ;;

  *)
    echo "Uso: bash install-pi-config.sh [--global|--project] [source_dir]" >&2
    exit 1
    ;;
esac

echo "Pronto. Reinicie o Pi ou use /reload para aplicar."
