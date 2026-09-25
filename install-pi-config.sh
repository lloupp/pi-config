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

canonical_dest() {
  local dest="$1"
  local parent
  parent="$(dirname "$dest")"
  mkdir -p "$parent"
  printf '%s/%s\n' "$(cd "$parent" && pwd -P)" "$(basename "$dest")"
}

mirror_dir() {
  local src="$1"
  local dest="$2"
  local label="$3"
  local parent base stage backup=""

  if [[ ! -d "$src" ]]; then
    echo "  - $label não encontrado em $SRC_DIR; pulando." >&2
    return
  fi

  dest="$(canonical_dest "$dest")"
  if [[ "$src" == "$dest" ]]; then
    echo "  ✓ $label (já no destino)"
    return
  fi

  parent="$(dirname "$dest")"
  base="$(basename "$dest")"
  stage="$(mktemp -d "$parent/.${base}.stage.XXXXXX")"
  # O nome temporário precisa estar no mesmo filesystem, mas a cópia deve criar a raiz
  # para preservar permissões/metadados do diretório de origem (mktemp cria 0700).
  rmdir "$stage"

  # Copia tudo antes de tocar no destino atual. Se a cópia falhar (disco cheio,
  # permissão, I/O), o recurso antigo continua intacto.
  if ! cp -a -- "$src" "$stage"; then
    rm -rf -- "$stage"
    echo "Erro: falha preparando $label; destino atual preservado." >&2
    return 1
  fi

  if [[ -e "$dest" || -L "$dest" ]]; then
    backup="$(mktemp -d "$parent/.${base}.backup.XXXXXX")"
    rmdir "$backup"
    if ! mv -- "$dest" "$backup"; then
      rm -rf -- "$stage"
      echo "Erro: não foi possível preparar a troca de $label; destino atual preservado." >&2
      return 1
    fi
  fi

  if mv -- "$stage" "$dest"; then
    [[ -z "$backup" ]] || rm -rf -- "$backup"
    echo "  ✓ $label"
    return
  fi

  # A cópia já estava pronta, mas a troca falhou. Tenta restaurar o destino antigo;
  # se a restauração também falhar, preserva o backup no disco e informa o caminho.
  if [[ -n "$backup" && ( -e "$backup" || -L "$backup" ) ]]; then
    if mv -- "$backup" "$dest"; then
      rm -rf -- "$stage"
      echo "Erro: falha ativando $label; destino anterior restaurado." >&2
    else
      echo "Erro crítico: falha ativando $label e restaurando o destino. Backup preservado em $backup" >&2
    fi
  else
    rm -rf -- "$stage"
    echo "Erro: falha ativando $label; nenhum destino anterior existia." >&2
  fi
  return 1
}

copy_file() {
  local src="$1"
  local dest="$2"
  local label="$3"
  local parent base stage

  if [[ ! -f "$src" ]]; then
    echo "  - $label não encontrado em $SRC_DIR; pulando." >&2
    return
  fi

  dest="$(canonical_dest "$dest")"

  # Em --project, a origem pode ser o próprio projeto atual; em --global, o usuário
  # também pode apontar explicitamente para ~/.pi/agent. Copiar sobre si mesmo falha.
  if [[ "$src" == "$dest" ]]; then
    echo "  ✓ $label (já no destino)"
    return
  fi

  parent="$(dirname "$dest")"
  base="$(basename "$dest")"
  stage="$(mktemp "$parent/.${base}.stage.XXXXXX")"
  if ! cp -p -- "$src" "$stage"; then
    rm -f -- "$stage"
    echo "Erro: falha preparando $label; destino atual preservado." >&2
    return 1
  fi
  if ! mv -f -- "$stage" "$dest"; then
    rm -f -- "$stage"
    echo "Erro: falha ativando $label; destino atual preservado." >&2
    return 1
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

    # Versões antigas instalavam o tema termux-neon. Remove só os arquivos dele; outros
    # temas do usuário ficam. No settings.json, remove a chave "theme" apenas se ela
    # ainda for termux-neon, para o pi voltar ao tema detectado; o resto não é tocado.
    rm -f -- "$DEST_DIR/themes/termux-neon.json" "$DEST_DIR/themes/termux-neon.md"
    rmdir -- "$DEST_DIR/themes" 2>/dev/null || true
    SETTINGS="$DEST_DIR/settings.json"
    if grep -q '"theme"[[:space:]]*:[[:space:]]*"termux-neon"' "$SETTINGS" 2>/dev/null; then
      if node -e '
        const fs = require("fs");
        const [file, tmp] = process.argv.slice(1);
        const settings = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
        if (settings.theme !== "termux-neon") process.exit(0);
        delete settings.theme;
        fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", { mode: fs.statSync(file).mode });
        fs.renameSync(tmp, file);
      ' "$SETTINGS" "$SETTINGS.tmp.$$" 2>/dev/null; then
        echo "  ✓ tema termux-neon removido do settings.json"
      else
        rm -f -- "$SETTINGS.tmp.$$"
        echo "  ! não foi possível editar settings.json; remova a chave \"theme\" à mão." >&2
      fi
    fi
    ;;

  --project|project)
    PROJECT_ROOT="$(pwd -P)"
    PI_DIR="$PROJECT_ROOT/.pi"
    echo "Instalando Pi config de projeto de $SRC_DIR em $PROJECT_ROOT"
    mkdir -p "$PI_DIR"

    # O DefaultResourceLoader do Pi procura contexto em <projeto>/AGENTS.md e os demais
    # recursos em <projeto>/.pi/{prompts,skills,extensions}. `.pi/agent` não é um local
    # de descoberta de recursos de projeto.
    # O AGENTS.md na raiz costuma ser do próprio projeto: guarda uma cópia antes de
    # sobrescrever, sem nunca apagar um backup anterior.
    if [[ -f "$PROJECT_ROOT/AGENTS.md" ]] && ! cmp -s "$SRC_DIR/AGENTS.md" "$PROJECT_ROOT/AGENTS.md"; then
      BACKUP="$PROJECT_ROOT/AGENTS.md.bak"
      [[ ! -e "$BACKUP" ]] || BACKUP="$BACKUP.$(date +%Y%m%d%H%M%S)"
      cp -p -- "$PROJECT_ROOT/AGENTS.md" "$BACKUP"
      echo "  ! AGENTS.md do projeto salvo em $(basename "$BACKUP")" >&2
    fi
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
