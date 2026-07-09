---
name: agent-loop
description: "Disciplina de loop para construir algo novo em tarefas longas: uma mudança pequena por iteração, validação a cada passo e critérios de parada. Use para implementação iterativa com múltiplos passos. Para consertar algo quebrado use debug-loop; para otimizar algo que funciona use loop-engineering."
compatibility: Termux/Android, Linux, projetos de código.
---

# Agent Loop

O fluxo base (entender → planejar → implementar → validar → resumir) já está no AGENTS.md.
Esta skill adiciona a disciplina de loop para tarefas longas — onde o risco é acumular
mudanças grandes sem validação e se perder.

## Disciplina por iteração

1. **Uma mudança pequena por vez.** Se a próxima mudança não cabe numa frase, quebre-a.
2. **Valide a cada iteração**, não só no fim: rode o teste mais específico do que acabou
   de mudar; a suíte completa fica para o fim de cada bloco.
3. **Registre o progresso** em `task_list` quando houver mais de 2 passos — marque `done`
   imediatamente, não em lote.
4. **Se a validação quebrar**, conserte antes de empilhar a próxima mudança (se precisar
   investigar, troque para `debug-loop`). Para reverter a última edição com segurança,
   use `/undo` (checkpoint).
5. **A cada ~5 iterações, releia o objetivo** e compare com o que construiu — deriva de
   escopo em tarefa longa é silenciosa.

## Critérios de parada

Pare e peça confirmação se:
- precisar apagar dados
- precisar alterar configuração global
- os testes indicarem falha não relacionada
- encontrar segredo/token em arquivo
- houver ambiguidade que possa causar perda de trabalho

## Ao terminar

- Resuma: arquivos alterados, validação executada e resultado, próximos passos.
- Aprendizados estáveis sobre o projeto → `persistent_memory`; becos sem saída que
  custaram tempo → `error_lessons`.
