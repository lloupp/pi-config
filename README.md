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
  - `auto-check` — verifica sintaxe após cada edição (js, py, sh, json e frontmatter de
    `SKILL.md`); o erro volta direto ao agente para corrigir. `/autocheck on|off`.
  - `update-pi` — `/update-pi` puxa este repo, reinstala e recarrega; avisa no início da
    sessão quando há commits novos. `/sync-pi` faz o inverso, publicando as mudanças
    locais de `~/.pi/agent`.
- `skills/` — `verify`, `code-review`, `excel-charts`, `powerbi`. As duas primeiras
  impõem disciplina; as duas últimas carregam API real (openpyxl, DAX/M) que não está no
  peso do modelo. Skills são carregadas sob demanda: custam contexto só quando usadas.
- `prompts/` — templates `debug` e `commit-msg`.
- `tests/` — testes das extensões, runner nativo do Node.
- `install-pi-config.sh`, `run-tests.sh`.

## O que não está aqui, de propósito

O pi deliberadamente não constrói permissões, plan mode, subagents, lista de tarefas nem
MCP — não por limitação, mas porque cada um cobra um preço que o autor documenta:
permissão é teatro quando o agente já executa código; plan mode e subagent viram caixa
preta; lista de tarefas efêmera confunde o modelo mais do que ajuda; MCP custa tokens
que uma CLI com README não custa.

Este repo já teve os cinco, reimplementados por paridade com o Claude Code. Somavam
~2.800 linhas de extensão e um `AGENTS.md` de 13 KB injetado a cada turno — quatro vezes
o prompt inteiro do pi. Foram removidos. Se algum fizer falta de verdade, ele está no
histórico:

```bash
git log --oneline master        # onde tudo ainda existe
git checkout master -- extensions/permissions.ts
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

Depois, reinicie o pi ou use `/reload-pi`.

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
