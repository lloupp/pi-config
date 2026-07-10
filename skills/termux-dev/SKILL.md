---
name: termux-dev
description: Diretrizes para desenvolvimento em Termux/Android, sem sudo nem systemd, usando pkg e caminhos do Termux. Use quando o usuário pedir ajuda com Termux, Android, instalação de pacotes, shell ou ambiente de desenvolvimento no celular.
compatibility: Termux/Android.
---

# Termux Dev

Use esta skill quando o usuário pedir ajuda com Termux, Android, instalação de pacotes, shell, ambiente de desenvolvimento ou comandos Linux no celular.

## Diretrizes
- Lembre que o ambiente é Termux, sem `sudo` e normalmente sem systemd.
- Use `pkg`/`apt` do Termux; rode `pkg update` antes de instalar quando a instalação falhar por índice velho.
- Prefira caminhos sob `/data/data/com.termux/files/home` e `$PREFIX`.
- **Não existe `/tmp`**: use `$TMPDIR` (fica sob `$PREFIX/tmp`). Scripts que assumem `/tmp` quebram.
- Tenha cuidado com armazenamento externo; sugira `termux-setup-storage` quando necessário (arquivos do Android ficam em `~/storage/`).
- Antes de instalar muitos pacotes, explique a finalidade de cada um.

## Armadilhas comuns
- **Builds nativos** (node-gyp, pacotes Python com C): exigem `pkg install build-essential python` (clang, make). Se um `npm install`/`pip install` falhar compilando, é quase sempre isso.
- **Processos longos morrem em segundo plano**: o Android mata o Termux para economizar bateria. Para tarefas longas (builds, loops do agente), sugira `termux-wake-lock` antes e `termux-wake-unlock` depois.
- **Binários x86/glibc não rodam**: Termux é Android/bionic (geralmente aarch64). Ferramentas distribuídas como binário Linux comum (muitos `npx` que baixam binários, Playwright/Chrome, Electron) **não funcionam nativamente** — inclusive o servidor MCP `playwright` do `mcp.json`, que só deve ser usado no Linux. Alternativas: versão via `pkg`, ou `proot-distro` (Debian/Ubuntu dentro do Termux) para o que exigir glibc.
- **Rede em segundo plano** e DNS podem variar entre Android/ROMs; erros intermitentes de rede às vezes são o Android dozing, não o servidor.

## Integração com o Android (termux-api)
Com `pkg install termux-api` + app Termux:API instalado:
- `termux-notification -t "título" -c "corpo"` — avisar quando uma tarefa longa terminar;
- `termux-clipboard-get` / `termux-clipboard-set` — trocar texto com outros apps;
- `termux-battery-status` — checar bateria antes de builds pesados.
Se os comandos travarem, o app Termux:API não está instalado — diga isso em vez de tentar de novo.

## Checklist
1. Verificar sistema: `uname -a`, `echo $PREFIX`, `pkg list-installed` quando útil (ou `/envcheck`).
2. Verificar ferramentas: `git`, `node`, `python`, `rg`, `fd`, `jq`.
3. Evitar instruções de desktop Linux incompatíveis (sudo, systemd, apt de distro, binários glibc).
4. Sugerir comandos curtos e copiáveis.
