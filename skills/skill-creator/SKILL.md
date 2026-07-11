---
name: skill-creator
description: "Procedimento para criar ou reformar skills deste setup: entender o gatilho, checar sobreposição com as skills existentes, escrever SKILL.md com frontmatter válido, validar, registrar no AGENTS.md/README e testar. Use quando o usuário pedir para criar uma skill, transformar um fluxo repetido em skill, ou melhorar uma skill existente."
compatibility: Pi em Termux/Android ou Linux; requer acesso de escrita ao diretório de skills.
---

# Skill Creator

Skill é **instrução para o agente**, não tutorial para humano ler. Antes de escrever qualquer linha, responda: *o que o agente fará DIFERENTE quando esta skill estiver ativa?* Se a resposta for "nada, é só informação", o conteúdo pertence ao README ou ao AGENTS.md — não crie a skill.

## Fase 1 — Entender a necessidade

Pergunte (ao usuário ou ao contexto) e anote:
- **Gatilho**: que frases/situações devem ativar a skill? (vão para a description)
- **Comportamento**: o que o agente deve fazer — um procedimento com passos (skill de ação) ou um método de raciocínio (skill de método)?
- **Ambiente**: Termux, Linux ou ambos? (vai para compatibility)

## Fase 2 — Checar sobreposição (obrigatório)

Liste as skills existentes (`ls ~/.pi/agent/skills/` ou `skills/` no repo pi-config) e leia a description das parecidas:
- coberto por skill existente → **melhore a existente** em vez de criar;
- sobreposição parcial → crie, mas adicione **regra de roteamento** explícita nas duas descriptions (padrão dos loops: "construir novo = agent-loop; consertar quebrado = debug-loop; otimizar = loop-engineering");
- sem sobreposição → crie.

## Fase 3 — Pesquisar fatos (se a skill depende de conhecimento externo)

Fatos de ferramenta/plataforma (sintaxe de config, comandos, APIs): confirme com `web_search`/`web_fetch` ou documentação local antes de embutir. **Nunca escreva de memória um comando que você não confirmou** — skill com fato errado ensina o erro para sempre. Cite a fonte num comentário quando o fato for não-óbvio.

## Fase 4 — Escrever o SKILL.md

Local: `skills/<nome-kebab-case>/SKILL.md`. Frontmatter com **exatamente** estas 3 chaves:

```markdown
---
name: <nome-kebab-case>
description: "<o que faz + 'Use quando' com os gatilhos da Fase 1. Entre aspas se contiver dois-pontos.>"
compatibility: <Termux/Android, Linux, ou ambos; pré-requisitos>
---
```

Corpo — escolha o esqueleto:

**Skill de AÇÃO** (o agente executa algo; ex.: termux-integration):
- Fase 0: guarda de ambiente (quando aplicável) — verifique e pare se não se aplica;
- diagnóstico só-leitura antes de mudar qualquer coisa;
- **backup antes de editar** arquivo do usuário;
- passos numerados, cada um com o comando exato e a verificação;
- relatório final: o que mudou, o que foi verificado, o que só o usuário pode confirmar;
- troubleshooting (sintoma → correção).

**Skill de MÉTODO** (o agente raciocina diferente; ex.: self-debate, verify):
- quando usar E quando não usar (a segunda metade evita uso teatral);
- o processo em passos com critérios objetivos;
- formato de saída esperado;
- anti-padrões (como a skill falha quando mal usada).

## Fase 5 — Regras de qualidade (checklist antes de salvar)

- [ ] Cada instrução muda o comportamento do agente (nada de contexto decorativo).
- [ ] Comandos/fatos embutidos foram confirmados (Fase 3), não inventados.
- [ ] Integra com as ferramentas do setup quando fizer sentido: `persistent_memory`, `error_lessons`, `web_search`, `subagent`, `task_list`, `/undo` — não reinvente o que já existe.
- [ ] Não duplica o AGENTS.md (que já está sempre no contexto).
- [ ] Curta: se passar de ~120 linhas, corte — skill longa gasta contexto toda vez que carrega.
- [ ] Nada de segredos, tokens ou caminhos pessoais sensíveis.
- [ ] Passos de verificação incluídos; o que não dá para verificar está declarado como tal.

## Fase 6 — Validar, registrar e testar

1. **Validar frontmatter** (dois-pontos fora de aspas quebra o YAML — o bug clássico):
```bash
python3 -c "
import re, yaml, sys
t = open(sys.argv[1]).read()
m = re.match(r'^---\n(.*?)\n---\n', t, re.S)
assert m, 'sem frontmatter'
d = yaml.safe_load(m.group(1))
assert sorted(d.keys()) == ['compatibility','description','name'], d.keys()
print('frontmatter OK:', d['name'])" skills/<nome>/SKILL.md
```
2. **Registrar**: uma linha em `AGENTS.md` (seção "Skills recomendadas", com a regra de roteamento se houver) e no `README.md` (lista de skills).
3. **Aplicar e testar**: `/reload-pi`, depois simule uma frase-gatilho e confirme que o agente usa a skill. Se não usar, o problema quase sempre é a description — reescreva os gatilhos.
4. Se for repo git: commit somente se o usuário pedir (regra do AGENTS.md).

## Anti-padrões (o que já vimos dar errado)

- **Tutorial disfarçado de skill**: conteúdo para humano ler → README/doc, não skill.
- **Description vaga** ("ajuda com X"): o agente nunca a ativa. Descreva gatilhos concretos.
- **Fato de memória**: sintaxe de config inventada parece certa e está errada. Confirme antes.
- **Skill-clone do AGENTS.md**: paga o custo de contexto duas vezes (caso agent-loop, já corrigido).
- **Sem critério de parada/saída**: skill de método sem formato de saída vira prosa infinita.
