---
name: loop-engineering
description: Loop iterativo verification-gated para melhorar um artefato (código, SQL, prompt, texto, análise) iterando contra um sinal real até atingir critério de parada. Use quando o usuário pedir "loop", "melhore até", "otimize iterativamente" ou para tarefas de refinamento contínuo.
compatibility: Pi no Termux/Android ou Linux, projetos de código/dados/escrita. Usa task_list, project_snapshot, persistent_memory.
---

# Loop Engineering (verification-gated)

Em vez de uma única tacada, o agente **itera contra um sinal real** (testes, métrica, latência, juiz
calibrado) e mantém só as mudanças que realmente melhoram.

> Aviso honesto: loops não supervisionados são famosos por girar indefinidamente e "shipar" lixo. A defesa é a
> **verification gate**: um sinal objetivo decide cada passo e uma **condição de parada explícita** encerra o loop.

## Qual loop usar

Há três skills de loop; escolha pela natureza da tarefa:

- **construir algo novo** (feature, script, config) → `agent-loop`;
- **consertar algo quebrado** (bug, build falhando, teste vermelho) → `debug-loop`;
- **otimizar algo que já funciona** contra um sinal medível (desempenho, cobertura, qualidade de prompt/texto) → esta skill.

Se a tarefa de otimização revelar um bug, troque para `debug-loop`, conserte e volte.

## Os 5 ingredientes de todo loop

1. **Programa** — este SKILL.md (o procedimento do loop).
2. **Slot de artefato** — o que está sendo melhorado (um arquivo, query, prompt, seção de texto).
3. **Sinal de feedback** — o que dirige o próximo passo (testes passando, métrica sobe, juiz aprova).
4. **Run ledger** — log append-only de cada iteração (o que foi tentado, sinal antes/depois, decisão).
5. **Terminação** — quando parar (plateau, orçamento de passos, ou limiar atingido).

## Ciclo OBSERVE → THINK → ACT → REFLECT → DECIDE

Repita até a condição de parada:

1. **OBSERVE** — leia o estado atual do artefato e o sinal de feedback (ex.: rode os testes).
2. **THINK** — proponha **UMA** mudança pequena e concreta, declarando **a intenção**: mover o sinal
   (ex.: passar mais testes, baixar latência) ou mudança neutra intencional (ex.: legibilidade) que o
   sinal só precisa **proteger**.
3. **ACT** — aplique a mudança (edite o arquivo / rode o comando). Preserve trabalho existente.
4. **REFLECT** — meça o sinal novamente. Se o resultado for suspeito (teste flaky, tempo variando),
   **meça de novo antes de decidir** — não reverta nem mantenha por causa de ruído.
5. **DECIDE** — julgue pela intenção declarada no THINK:
   - mudança que tentava **mover o sinal**: melhorou → KEEP; piorou ou ficou igual → REVERT.
   - mudança **neutra intencional** (legibilidade, organização): sinal não piorou **e** cumpre o
     objetivo declarado → KEEP; sinal piorou → REVERT.
   - condição de **parada** atingida → encerre e entregue o melhor artefato.

Para reverter: use `/undo` (checkpoint da última edição) ou, em repositório git, `git diff` + restauração
do trecho — nunca reescreva de memória.

## Run ledger (exemplo)

Mantenha no início da resposta ou em `task_list`. Exemplo:

```
iter | proposta (intenção)                       | sinal_antes | sinal_depois | decisão
1    | extrair função duplicada (mover sinal)    | tests 12/14 | 14/14        | KEEP
2    | renomear x->userId (neutra: legibilidade) | 14/14       | 14/14        | KEEP (neutra, objetivo cumprido)
3    | memoizar calcPricing (mover sinal)        | 220ms       | 90ms         | KEEP
4    | cache agressivo em fetchAll (mover sinal) | 90ms        | 95ms         | REVERT (piorou)
```

## Critérios de parada (defina ANTES de começar)

- **Orçamento**: máximo N iterações (ex.: 10).
- **Plateau**: M iterações sem melhora (ex.: 3).
- **Limiar**: sinal atingiu a meta (ex.: 100% testes, <100ms, juiz ≥ 4/5).
- **Sinal instável**: se o sinal oscilar entre medições sem mudança no artefato, pare o loop e
  estabilize o sinal primeiro (corrigir teste flaky, fixar seed, medir mediana de 3 execuções).

## Integração com as ferramentas do Pi

- `task_list` como ledger leve; `project_snapshot` no OBSERVE inicial.
- `/undo` (checkpoint) para reverter a última edição com segurança.
- `error_lessons` (scope repo) ao fim do loop: registre as tentativas REVERT que pareciam boas mas
  pioraram o sinal — é isso que evita repetir o mesmo beco em sessões futuras.
- `persistent_memory` (scope repo) para os aprendizados positivos estáveis (o que funcionou e por quê).
- Nunca salve segredos, tokens ou `.env` no ledger ou nas memórias.

## Exemplos de binding (sua tarefa no momento da invocação)

- **Código**: artefato=`src/calc.ts`, sinal=`npm test`, parada=100% verde ou 8 iters.
- **SQL**: artefato=`query.sql`, sinal=`EXPLAIN`/tempo, parada=<200ms.
- **Prompt**: artefato=`prompt.md`, sinal=juiz (qualidade da saída), parada=≥4/5.
- **Texto/escrita**: artefato=`doc.md`, sinal=checklist de requisitos, parada=todos atendidos.

## Risco e segurança

Pare e peça confirmação se:
- precisar apagar dados ou alterar configuração global;
- o sinal for subjetivo demais para decidir manter/reverter;
- detectar loop girando sem progresso (force plateau stop);
- encontrar segredo/token — avise sem repetir o valor.
