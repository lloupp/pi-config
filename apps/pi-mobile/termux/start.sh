#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
command -v pi >/dev/null || { echo 'Pi não encontrado. Execute termux/install.sh primeiro.' >&2; exit 1; }
export PI_MOBILE_WORKSPACE="${PI_MOBILE_WORKSPACE:-$HOME/projects}"
exec node "$ROOT/apps/pi-mobile/termux/server.cjs"
