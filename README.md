# Pi Personal Configuration

Configuração personalizada do Pi Coding Agent para uso em Termux/Android.

## Conteúdo

- `AGENTS.md` — instruções globais do agente
- `settings.json` — preferências (tema, modelo padrão)
- `prompts/` — templates reutilizáveis (`review`, `debug`, `commit-msg`, `termux-setup`)
- `skills/` — skills: `agent-loop`, `debug-loop`, `code-review`, `git-workflow`, `termux-dev`, `learn-repository`
- `extensions/` — extensões TypeScript personalizadas:
  - `persistent-memory` — memória persistente entre sessões
  - `plan-tasks` — modo plano e gestão de tarefas
  - `safety-guard` — proteção contra comandos perigosos
  - `termux-tools` — comandos e ferramentas para Termux
  - `pi-status` — status no footer
- `themes/` — tema customizado `termux-neon`
- `install-pi-config.sh` — script de instalação

## Como instalar

```bash
# Clone ou copie este diretório
bash install-pi-config.sh
```

## Como contribuir com suas próprias modificações

```bash
cd ~/pi-config
git add .
git commit -m "Sua modificação"
git push origin main
```