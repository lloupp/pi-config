#!/bin/bash
# run-tests.sh - Roda a suíte de testes das extensões
# Usa apenas o runner nativo do Node (node:test); não há dependências a instalar.
#
# Os testes carregam cada extensão com o mesmo jiti e os mesmos virtualModules que o Pi
# usa, então precisam encontrar o pacote @earendil-works/pi-coding-agent. A busca é
# automática (binário `pi` no PATH, depois npm root -g); para apontar manualmente:
#   PI_PACKAGE_DIR=/caminho/do/pacote bash run-tests.sh

set -euo pipefail

cd "$(dirname "$0")"

exec node --test tests/*.test.mjs
