# Pi Personal Configuration

Configuração pessoal do [Pi Coding Agent](https://pi.dev).

O pi entrega quatro ferramentas — `read`, `write`, `edit`, `bash` — e um prompt de
sistema abaixo de mil tokens, porque o autor parte de um critério explícito: *se eu não
preciso, não é construído*. Esta configuração adota o mesmo critério. Cada item aqui
existe porque faz algo que o modelo não faz sozinho, e o que não passa nesse teste foi
removido.

## Conteúdo

- `AGENTS.md` — instruções globais. Regras de honestidade intelectual, disciplina de
  mudança e segurança. Não descreve ferramentas (cada uma já traz a própria descrição)
  nem lista skills (o pi as descobre pelo frontmatter).
- `extensions/` — extensões TypeScript:
  - `web-tools` — `web_search` e `web_fetch`. O pi não tem acesso à internet embutido.
  - `checkpoint` — snapshot antes de cada edição do agente. `/undo` desfaz a última,
    `/checkpoints` lista, `/rewind` volta ao estado anterior a um pedido seu. Funciona
    fora de repositório git.
  - [`observatorio`](extensions/observatorio/README.md) — `/observatorio` abre uma
    constelação dos arquivos e ferramentas da sessão, com falhas em destaque e replay
    visual sem reexecutar nada. Layout adaptável ao Termux e ao Linux, sem IA extra.
  - [`lightpanda`](extensions/lightpanda.md) — `browser_open` renderiza páginas que
    dependem de JavaScript, e `browser_start`/`click`/`fill`/`close` interagem com elas
    mantendo a sessão. O `web_fetch` só lê HTML estático. Exige o binário do Lightpanda;
    no Termux, roda via `proot-distro`.
  - `auto-check` — verifica sintaxe após cada edição (js, py, sh, json e frontmatter de
    `SKILL.md`); o erro volta direto ao agente para corrigir. `/autocheck on|off`.
  - `update-pi` — `/update-pi` puxa este repo, reinstala e recarrega; avisa no início da
    sessão quando há commits novos. `/sync-pi` faz o inverso, publicando as mudanças
    locais de `~/.pi/agent`.
- `skills/` — `plan`, `delegate`, `verify`, `code-review`, `excel-charts`, `powerbi`. As
  quatro primeiras impõem disciplina; as duas últimas carregam API real (openpyxl, DAX/M)
  que não está no peso do modelo. Skills são carregadas sob demanda: custam contexto só
  quando usadas.
- `prompts/` — templates `debug` e `commit-msg`.
- `tests/` — testes das extensões, runner nativo do Node.
- `install-pi-config.sh`, `run-tests.sh`.

## Plano, tarefas e subagente — sem extensão

O pi não constrói plan mode, lista de tarefas nem subagents, e o motivo não é capricho:
plan mode e subagent viram caixa preta, e lista de tarefas efêmera confunde o modelo mais
do que ajuda. A objeção é a **falta de observabilidade**, não a funcionalidade.

Tirada a objeção, os três continuam úteis — e cabem em duas skills, sem uma linha de
TypeScript:

- **`plan`** — o plano é um arquivo markdown com caixas de seleção. Isso resolve o plano e
  a lista de tarefas de uma vez: um plano com `- [ ]` **é** a lista. O usuário lê com
  `cat`, edita no editor dele enquanto o agente trabalha, e o progresso sobrevive à queda
  da sessão porque mora no disco. Não bloqueia escrita nem abre diálogo de aprovação —
  isso seria a máquina de permissões de volta; o gate é você responder "pode ir".
- **`delegate`** — subagente é `pi -p` chamado por bash, com allowlist de tools. Você vê o
  comando e a saída inteira. É a resposta do próprio autor: spawnar por bash em vez de um
  protocolo próprio, porque assim nada acontece fora da tela.

Custo: duas descrições de skill em contexto. O corpo só é lido quando a skill é usada.

## O que não está aqui, de propósito

Permissões e MCP continuam fora. Permissão é teatro quando o agente já executa código, e
MCP custa tokens que uma CLI com README não custa.

Este repo já teve os dois — mais versões em extensão de plano, tarefas e subagente,
reimplementadas por paridade com o Claude Code. Somavam ~2.800 linhas e um `AGENTS.md` de
13 KB injetado a cada turno, quatro vezes o prompt inteiro do pi. Se algum fizer falta de
verdade, está no histórico:

```bash
git log --oneline --all -- extensions/permissions.ts   # commits onde ele existiu
git checkout 55d032b -- extensions/permissions.ts
```

Voltar uma peça porque você sentiu falta dela é o critério certo. Voltar porque outra
ferramenta tem é o que trouxe o repo até aqui.

## Modelos

Não versionados. Provider, modelo e pacotes são escolha de cada máquina e moram no
`~/.pi/agent/settings.json`, que o instalador **não** toca — do contrário, cada
`/update-pi` apagaria essa escolha.

## Instalar

```bash
bash install-pi-config.sh              # global, em ~/.pi/agent
bash install-pi-config.sh --project    # no projeto atual, em .pi/agent
```

Depois, reinicie o pi ou use `/reload`.

## Testes

```bash
bash run-tests.sh
```

Só o runner nativo do Node (`node:test`), nada para instalar. Os testes carregam cada
extensão com o mesmo `jiti` e os mesmos `virtualModules` que o pi usa, então exercitam o
código de verdade. Os que tocam disco usam diretórios temporários com `HOME` e
`PI_CODING_AGENT_DIR` isolados — a configuração real nunca é lida nem escrita.

Se o pacote do pi não for encontrado, aponte o caminho:
`PI_PACKAGE_DIR=/caminho/do/pacote bash run-tests.sh`.
