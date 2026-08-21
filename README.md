# Pi Personal Configuration

Configuração personalizada do Pi Coding Agent para uso em Termux/Android.

## Conteúdo

- `AGENTS.md` — instruções globais do agente
- `settings.json` — preferências (tema, modelo padrão) e regras de permissão
- `keybindings.json` — atalhos: move o ciclo de thinking para **Alt+T**, liberando o **Shift+Tab** para o ciclo de modos de permissão, como no Claude Code
- `mcp.json` — servidores MCP (formato igual ao do Claude Desktop/Code); vem com o `@playwright/mcp` (automação do Chrome; só Linux — Chrome não roda nativo no Termux) e o `@upstash/context7-mcp` (documentação atualizada de bibliotecas; Termux e Linux; opcional: `CONTEXT7_API_KEY` no `env` aumenta o rate limit)
- `prompts/` — templates reutilizáveis (`review`, `debug`, `commit-msg`, `termux-setup`)
- `agents/` — tipos de subagente (`code-reviewer`, `test-writer`, `planner`), no formato dos subagents do Claude Code
- `skills/` — skills: `agent-loop`, `debug-loop`, `code-review`, `git-workflow`, `termux-dev`, `termux-integration`, `learn-repository`, `loop-engineering`, `self-debate`, `web-research`, `test-coverage`, `verify`, `skill-creator`, `mcp-attach`, `mcp-create`, `api-to-mcp`, `orchestrator`, `excel-charts`, `powerbi`
- `extensions/` — extensões TypeScript personalizadas:
  - `persistent-memory` — memória persistente entre sessões, e o atalho **`#`**: começar a mensagem com `#` guarda a instrução no `AGENTS.md` (do projeto ou global, você escolhe) sem gastar um turno, como o `#` do Claude Code — no pi o `AGENTS.md` faz o papel do `CLAUDE.md`. `/remember` faz o mesmo. A ferramenta `persistent_memory` (store JSON) continua servindo ao agente: são coisas diferentes, e o Claude Code também tem as duas
  - `hooks` — hooks configuráveis no `settings.json` (chave `hooks`), no formato do Claude Code: `PreToolUse`, `PostToolUse`, `UserPromptSubmit` e `Stop`, com `matcher` por regex de ferramenta. Os valores chegam ao comando como **parâmetros posicionais** (`$1` evento, `$2` ferramenta, `$3` caminho ou comando), nunca interpolados no texto — caminhos vêm do modelo e interpolar seria injeção. Sair com código 2 bloqueia (`PreToolUse`) ou devolve o stderr ao agente para corrigir (`PostToolUse`). `/hooks` lista o que está configurado
  - `error-lessons` — lições aprendidas com erros, injetadas nas próximas sessões
  - `web-tools` — ferramentas `web_search` e `web_fetch` para navegar na internet
  - `checkpoint` — snapshot automático antes de cada edição do agente, agrupado por turno. `/rewind` volta ao estado anterior a um pedido seu, escolhendo entre **código**, **conversa** (via fork da sessão) ou **ambos**, como no Claude Code — o seletor lista os turnos pela sua própria mensagem. `/undo` desfaz uma única edição e `/checkpoints` lista tudo. Arquivos acima de 1 MB entram na lista marcados como "sem undo", em vez de sumirem em silêncio. Não há equivalente ao `Esc Esc`: no pi o `escape` é o atalho de interromper, e a API não expõe duplo-toque
  - `auto-check` — verificação de sintaxe automática após cada edição (js, py, sh, json e frontmatter de SKILL.md); erro volta direto para o agente corrigir; `/autocheck on|off` — o ajuste agora fica no `settings.json` e sobrevive ao reload
  - `subagent` — ferramenta `subagent`: delega tarefas a um `pi -p` com contexto isolado. Tem **tipos nomeados** como os `subagent_type` do Claude Code, lidos de `agents/*.md` com frontmatter `name`/`description`/`tools`/`model` — o corpo do markdown vira o preâmbulo da tarefa. Os tipos do projeto (`.pi/agent/agents/`) têm precedência sobre os globais, e `explore` (somente leitura, padrão) e `full` continuam embutidos. `provider`/`model`/`thinking` explícitos sobrepõem o que o tipo define (base das skills `orchestrator` e do debate multi-modelo do `self-debate`)
  - `mcp` — cliente MCP (Model Context Protocol) via stdio, sem dependências; lê `mcp.json` e registra cada tool do servidor como `mcp_<servidor>_<tool>`; `/mcp start` liga todos (ou `/mcp start <servidor>` liga um), `/mcp stop` desliga, `/mcp` mostra status, `/mcp reload` reconecta
  - `plan-tasks` — modo plano estilo Claude Code e gestão de tarefas: `/plan <objetivo>` bloqueia escrita (exceto o próprio arquivo de plano, gravado em `.pi/plans/<slug>.md`) e restringe subagent ao tipo `explore`; bash fica liberado para investigar, como no plan mode do Claude Code — a garantia é o bloqueio de escrita mais a instrução do prompt e o `permissions`, não uma allowlist de comandos; o agente escreve o plano no arquivo e chama a ferramenta `exit_plan` (equivalente ao ExitPlanMode) que exibe o plano num painel **rolável** (↑↓ rolam, PgUp/PgDn/g/G saltam, ←→ trocam a opção, Enter confirma, 1-4 escolhem direto, Esc rejeita) com o gate do ExitPlanMode — **Sim, e aceitar edições automaticamente** / **Sim, aprovar cada edição** / **Não, continuar planejando**, mais um **Editar plano** que o Claude Code não tem; a escolha define em que modo de permissão a sessão continua (a tool roda em modo sequencial para o dialog não conflitar com outras tools do mesmo turno) — ao aprovar, libera a escrita e semeia o `task_list` a partir dos passos numerados; `/implement` aprova manualmente, `/tasks` lista; o modo plano entrou no ciclo do **Shift+Tab** (o antigo `Ctrl+Shift+P` saiu — não funcionava em terminal sem protocolo Kitty, incluindo o Termux legado); `/plans` lista os planos salvos e `/open-plan <slug>` reabre um existente — os planos persistem em `.pi/plans/` e sobrevivem a retomada de sessão (o estado do plano ativo é restaurado ao resumir)
  - `permissions` — sistema de permissões no modelo do Claude Code (a API do pi não tem um). **Shift+Tab** cicla os modos `perguntar` → `aceitar edições` → `plano`, com o modo atual no rodapé; `sem-confirmacao` fica fora do ciclo e só se entra nele por `/permissions sem-confirmacao`, com confirmação — como o `bypassPermissions` de lá. Regras `allow`/`ask`/`deny` no `settings.json` (chave `permissions`) no formato `Bash(git push:*)`, `Edit(src/**)`, `Read(.env)`, com `deny` > `ask` > `allow`; todo dialog oferece **"sempre permitir"**, que grava a regra. Herda do antigo `safety-guard` a proteção contra comandos perigosos (`rm -rf`, `git reset --hard`, `push --force`, `curl | sh`…), o bloqueio de escrita em `.git/`/`node_modules/`/segredos — que nenhuma regra `allow` libera — e a confirmação de **leitura** de arquivos sensíveis (`.env`, `.ssh/`, `*.pem`, `id_rsa`), inclusive via bash. `/permissions` mostra modo e regras. Desvio deliberado do Claude Code: bash comum não pede confirmação (só o destrutivo), porque sem uma allowlist pré-populada isso tornaria o agente inutilizável; `"askForAllBash": true` liga o comportamento estrito
  - `termux-tools` — comandos e ferramentas para Termux
  - `pi-status` — status no footer
  - `update-pi` — comando `/update-pi`: git pull no repo `~/pi-config`, reinstala em `~/.pi/agent` e recarrega numa tacada só; ao iniciar o Pi, verifica em segundo plano se há commits novos no remoto e avisa quando é hora de rodar `/update-pi`; e `/sync-pi` faz o caminho inverso — copia `~/.pi/agent` para o repo, commita e faz push (com rebase antes, para não conflitar com outra máquina)
  - `notify-done` — notificação do sistema (termux-notification no Android, notify-send no Linux) quando uma tarefa do agente demora mais que o limiar (90s); `/notify on|off|<segundos>` ajusta, e o ajuste fica no `settings.json`
- `themes/` — tema customizado `termux-neon`
- `tests/` — testes das extensões (runner nativo do Node, sem dependências)
- `install-pi-config.sh` — script de instalação
- `run-tests.sh` — roda a suíte de testes

## Pacotes da comunidade

Declarados no array `packages` do `settings.json`; o Pi baixa/atualiza no dispositivo com
`pi install`/`pi update --extensions` (ambos são TypeScript puro, sem binários nativos — funcionam no Termux):

- `@juicesharp/rpiv-ask-user-question` — ferramenta `ask_user_question`: o modelo faz perguntas
  estruturadas (opções tipadas, multi-select, revisão antes de enviar) em vez de adivinhar.
- `@vigolium/piolium` — auditorias de segurança multi-fase com subagents especializados, contexto
  isolado e estado retomável; complementa as skills `code-review`/`verify`.

Avaliados e descartados (fev/2026, catálogo pi.dev): `pi-mcp-adapter`, `pi-subagents` e
`pi-web-access` fazem o mesmo que as extensões próprias `mcp`, `subagent` e `web-tools` — mantidas
por serem enxutas, sem dependências e recém-auditadas; `context-mode` e `@hypabolic/pi-hypa`
dependem de binários nativos, frágeis no Termux.

## Como instalar

```bash
# Clone ou copie este diretório para ~/pi-config, então:
bash install-pi-config.sh              # instala globalmente em ~/.pi/agent
bash install-pi-config.sh --project    # instala no projeto atual (.pi/agent)
```

Somente os itens de configuração (`AGENTS.md`, `settings.json`, `prompts/`, `skills/`,
`extensions/`, `themes/`) são copiados. Depois, reinicie o Pi ou use `/reload-pi`.

## Testes

```bash
bash run-tests.sh
```

Usa só o runner nativo do Node (`node:test`) — nada para instalar. Os testes carregam cada
extensão com o mesmo `jiti` e os mesmos `virtualModules` que o Pi usa, então exercitam o
código de verdade: handlers de evento, comandos e ferramentas são chamados diretamente,
com um `pi` simulado.

Cobrem o carregamento de todas as extensões (pega erro de sintaxe e import quebrado, que
em uso normal só apareceriam como uma extensão silenciosamente ausente) e o comportamento
de `permissions`, `checkpoint`/`rewind`, `task_list`, `subagent`, `hooks`, `web-tools`, `mcp`,
`plan-tasks`, `notify-done`, do atalho `#` e dos dois stores de memória. Os que tocam disco
usam diretórios temporários com `HOME` e `PI_CODING_AGENT_DIR` isolados — a configuração e a
memória reais em `~/.pi/agent` nunca são lidas nem escritas.

Se o pacote do Pi não for encontrado automaticamente, aponte o caminho:
`PI_PACKAGE_DIR=/caminho/do/pacote bash run-tests.sh`.

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