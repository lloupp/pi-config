#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
if [[ ! -f "$ROOT/install-pi-config.sh" ]]; then
  echo 'Abra o repositório pi-config completo antes de executar este instalador.' >&2
  exit 1
fi
command -v pkg >/dev/null || { echo 'Execute dentro do Termux.' >&2; exit 1; }
pkg update -y
pkg install -y nodejs git
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
if [[ -d "$HOME/.pi/agent/extensions" || -d "$HOME/.pi/agent/skills" ]]; then
  BACKUP="$HOME/pi-config-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
  tar -czf "$BACKUP" -C "$HOME" .pi/agent || true
  echo "Backup antigo: $BACKUP"
fi
bash "$ROOT/install-pi-config.sh" --global "$ROOT"
echo 'Instalação pronta. Configure seu provedor com pi, depois inicie o servidor.'
echo "bash '$ROOT/apps/pi-mobile/termux/start.sh'"
