# Pi Personal Configuration

Configuração personalizada do Pi Coding Agent para uso em Termux/Android.

## Conteúdo

- `AGENTS.md` — instruções globais do agente
- `settings.json` — preferências (tema, modelo padrão)
- `mcp.json` — servidores MCP (formato igual ao do Claude Desktop/Code); vem com o `@playwright/mcp` (automação do Chrome; só Linux — Chrome não roda nativo no Termux) e o `@upstash/context7-mcp` (documentação atualizada de bibliotecas; Termux e Linux; opcional: `CONTEXT7_API_KEY` no `env` aumenta o rate limit)
- `prompts/` — templates reutilizáveis (`review`, `debug`, `commit-msg`, `termux-setup`)
- `skills/` — skills: `agent-loop`, `debug-loop`, `code-review`, `git-workflow`, `termux-dev`, `termux-integration`, `learn-repository`, `loop-engineering`, `self-debate`, `web-research`, `test-coverage`, `verify`, `skill-creator`, `mcp-attach`, `mcp-create`, `api-to-mcp`, `orchestrator`
- `extensions/` — extensões TypeScript personalizadas:
  - `persistent-memory` — memória persistente entre sessões
  - `error-lessons` — lições aprendidas com erros, injetadas nas próximas sessões
  - `web-tools` — ferramentas `web_search` e `web_fetch` para navegar na internet
  - `checkpoint` — snapshot automático antes de cada edição do agente; `/undo` e `/checkpoints` para reverter
  - `auto-check` — verificação de sintaxe automática após cada edição (js, py, sh, json); erro volta direto para o agente corrigir; `/autocheck on|off`
  - `subagent` — ferramenta `subagent`: delega tarefas a um `pi -p` com contexto isolado (modo explore somente leitura ou full); aceita `provider`/`model`/`thinking` para rodar com um modelo alternativo (base das skills `orchestrator` e do debate multi-modelo do `self-debate`)
  - `mcp` — cliente MCP (Model Context Protocol) via stdio, sem dependências; lê `mcp.json` e registra cada tool do servidor como `mcp_<servidor>_<tool>`; `/mcp` mostra status, `/mcp reload` reconecta
  - `plan-tasks` — modo plano e gestão de tarefas
  - `safety-guard` — proteção contra comandos perigosos
  - `termux-tools` — comandos e ferramentas para Termux
  - `pi-status` — status no footer
  - `update-pi` — comando `/update-pi`: git pull no repo `~/pi-config`, reinstala em `~/.pi/agent` e recarrega numa tacada só
- `themes/` — tema customizado `termux-neon`
- `install-pi-config.sh` — script de instalação

## Como instalar

```bash
# Clone ou copie este diretório para ~/pi-config, então:
bash install-pi-config.sh              # instala globalmente em ~/.pi/agent
bash install-pi-config.sh --project    # instala no projeto atual (.pi/agent)
```

Somente os itens de configuração (`AGENTS.md`, `settings.json`, `prompts/`, `skills/`,
`extensions/`, `themes/`) são copiados. Depois, reinicie o Pi ou use `/reload-pi`.

## Como atualizar este backup a partir do ambiente atual

```bash
cp -r ~/.pi/agent/AGENTS.md ~/.pi/agent/settings.json \
      ~/.pi/agent/prompts ~/.pi/agent/skills \
      ~/.pi/agent/extensions ~/.pi/agent/themes ~/pi-config/
```

## Como contribuir com suas próprias modificações

```bash
cd ~/pi-config
git add .
git commit -m "Sua modificação"
git push origin master
```