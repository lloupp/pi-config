---
name: termux-dev
description: Diretrizes para desenvolvimento em Termux/Android, sem sudo nem systemd, usando pkg e caminhos do Termux. Use quando o usuário pedir ajuda com Termux, Android, instalação de pacotes, shell ou ambiente de desenvolvimento no celular.
compatibility: Termux/Android.
---

# Termux Dev

Use esta skill quando o usuário pedir ajuda com Termux, Android, instalação de pacotes, shell, ambiente de desenvolvimento ou comandos Linux no celular.

## Diretrizes
- Lembre que o ambiente é Termux, sem `sudo` e normalmente sem systemd.
- Use `pkg`/`apt` do Termux.
- Prefira caminhos sob `/data/data/com.termux/files/home` e `$PREFIX`.
- Tenha cuidado com armazenamento externo; sugira `termux-setup-storage` quando necessário.
- Antes de instalar muitos pacotes, explique a finalidade de cada um.

## Checklist
1. Verificar sistema: `uname -a`, `echo $PREFIX`, `pkg list-installed` quando útil.
2. Verificar ferramentas: `git`, `node`, `python`, `rg`, `fd`, `jq`.
3. Evitar instruções de desktop Linux incompatíveis.
4. Sugerir comandos curtos e copiáveis.
