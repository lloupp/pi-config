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
  - `auto-check` — verificação de sintaxe automática após cada edição (js, py, sh, json e frontmatter de SKILL.md); erro volta direto para o agente corrigir; `/autocheck on|off`
  - `subagent` — ferramenta `subagent`: delega tarefas a um `pi -p` com contexto isolado (modo explore somente leitura ou full); aceita `provider`/`model`/`thinking` para rodar com um modelo alternativo (base das skills `orchestrator` e do debate multi-modelo do `self-debate`)
  - `mcp` — cliente MCP (Model Context Protocol) via stdio, sem dependências; lê `mcp.json` e registra cada tool do servidor como `mcp_<servidor>_<tool>`; `/mcp start` liga todos (ou `/mcp start <servidor>` liga um), `/mcp stop` desliga, `/mcp` mostra status, `/mcp reload` reconecta
  - `plan-tasks` — modo plano estilo Claude Code e gestão de tarefas: `/plan <objetivo>` bloqueia escrita (exceto o próprio arquivo de plano, gravado em `.pi/plans/<slug>.md`), restringe bash ao investigativo e subagent a `mode=explore`; o agente escreve o plano no arquivo e chama a ferramenta `exit_plan` (equivalente ao ExitPlanMode) que abre um gate **Aprovar/Editar/Rejeitar** — ao aprovar, libera a escrita e semeia o `task_list` a partir dos passos numerados; `/implement` aprova manualmente, `/tasks` lista, `Ctrl+Shift+P` alterna o modo; `/plans` lista os planos salvos e `/open-plan <slug>` reabre um existente — os planos persistem em `.pi/plans/` e sobrevivem a retomada de sessão (o estado do plano ativo é restaurado ao resumir)
  - `safety-guard` — proteção contra comandos perigosos (`rm -rf`, `git reset --hard`, `push --force`, `curl | sh`…) e contra escrita em caminhos protegidos (`.git/`, `node_modules/`); também confirma **leitura** de arquivos sensíveis (`.env`, `.ssh/`, `auth.json`, `credentials.json`, `*.pem`, `id_rsa`), inclusive tentativas de lê-los via bash (`cat`/`grep`/`less`)
  - `termux-tools` — comandos e ferramentas para Termux
  - `pi-status` — status no footer
  - `update-pi` — comando `/update-pi`: git pull no repo `~/pi-config`, reinstala em `~/.pi/agent` e recarrega numa tacada só; ao iniciar o Pi, verifica em segundo plano se há commits novos no remoto e avisa quando é hora de rodar `/update-pi`; e `/sync-pi` faz o caminho inverso — copia `~/.pi/agent` para o repo, commita e faz push (com rebase antes, para não conflitar com outra máquina)
  - `notify-done` — notificação do sistema (termux-notification no Android, notify-send no Linux) quando um turno do agente demora mais que o limiar (90s); `/notify on|off|<segundos>` ajusta
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