---
name: loop-engineering
description: Loop iterativo verification-gated para melhorar um artefato (código, SQL, prompt, texto, análise) iterando contra um sinal real até atingir critério de parada. Use quando o usuário pedir "loop", "melhore até", "otimize iterativamente" ou para tarefas de refinamento contínuo.
compatibility: Pi no Termux/Android ou Linux, projetos de código/dados/escrita. Usa task_list, project_snapshot, persistent_memory.
---

# Loop Engineering (verification-gated)

Inspirado em `gaasher/Agent-Loop-Skills` e `agentic-loop-skill` (OBSERVE→THINK→ACT→REFLECT→DECIDE).
Em vez de uma única tacada, o agente **itera contra um sinal real** (testes, métrica, latência, juiz
calibrado) e mantém só as mudanças que realmente melhoram. Disciplina de verificação, não autonomia pelo
próprio sake.

> Aviso honesto: loops não supervisionados famosos por girar indefinidamente e "shipar" lixo. A defesa é a
> **verification gate**: um sinal objetivo decide cada passo e uma **condição de parada explícita** encerra o loop.

## Os 5 ingredientes de todo loop

1. **Programa** — este SKILL.md (o procedimento do loop).
2. **Slot de artefato** — o que está sendo melhorado (um arquivo, query, prompt, seção de texto).
3. **Sinal de feedback** — o que dirige o próximo passo (testes passando, métrica sobe, juiz aprova).
4. **Run ledger** — log append-only de cada iteração (o que foi tentado, sinal antes/depois, decisão).
5. **Terminação** — quando parar (plateau, orçamento de passos, ou limiar atingido).

## Ciclo OBSERVE → THINK → ACT → REFLECT → DECIDE

Repita até a condição de parada:

1. **OBSERVE** — leia o estado atual do artefato e o sinal de feedback (ex.: rode os testes).
2. **THINK** — proponha **UMA** mudança pequena e concreta que deva melhorar o sinal.
3. **ACT** — aplique a mudança (edite o arquivo / rode o comando). Preserve trabalho existente.
4. **REFLECT** — meça o sinal novamente (testes, métrica, juiz). Compare com o valor anterior.
5. **DECIDE**
   - se **melhor** → mantenha + registre no ledger.
   - se **pior/igual** → reverta a mudança.
   - se **parada** → encerre e entregue o melhor artefato.

## Run ledger (exemplo)

Mantenha no início da resposta ou em `task_list`. Exemplo:

```
iter | proposta                         | sinal_antes | sinal_depois | decisão
1    | extrair função duplicated code   | tests 12/14 | 14/14        | KEEP
2    | renomear var x->userId           | 14/14       | 14/14        | REVERT (sem ganho)
3    | memoizar calcPricing             | 14/14       | 220ms->90ms  | KEEP
```

## Critérios de parada (defina ANTES de começar)

- **Orçamento**: máximo N iterações (ex.: 10).
- **Plateau**: M iterações sem melhora (ex.: 3).
- **Limiar**: sinal atingiu a meta (ex.: 100% testes, <100ms, juiz ≥ 4/5).

## Uso no Pi (spawn-or-degrade)

- Para múltiplas roles (propor vs. julgar), use inline no mesmo agente (degrade graceful) em vez de
  subagentes externos, salvo se o host suportar.
- Use `task_list` como ledger leve e `project_snapshot` no OBSERVE inicial.
- Use `persistent_memory` (scope repo) para guardar aprendizados estáveis entre iterações/sessões.
- Nunca salve segredos, tokens ou `.env` no ledger.

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
