---
name: agent-loop
description: "Fluxo iterativo para tarefas de desenvolvimento: entender, planejar, implementar, testar, corrigir e resumir. Use quando a tarefa exigir múltiplos passos ou validação contínua."
compatibility: Termux/Android, Linux, projetos de código.
---

# Agent Loop

Use este loop para trabalhar com segurança e evitar mudanças grandes demais.

## Loop principal

1. **Entender**
   - Leia arquivos relevantes antes de editar.
   - Use `project_snapshot` quando precisar de visão geral.
   - Verifique `git status --short` se estiver em repositório.

2. **Planejar**
   - Divida em passos pequenos.
   - Use `task_list` para registrar tarefas quando houver mais de 2 passos.
   - Se houver incerteza, faça perguntas ou ative `/plan`.

3. **Implementar**
   - Faça uma mudança pequena por vez.
   - Preserve mudanças existentes do usuário.
   - Evite comandos destrutivos.

4. **Validar**
   - Rode testes, lint, typecheck ou comando mínimo relevante.
   - Se não houver testes, explique qual validação manual foi feita.

5. **Corrigir**
   - Se a validação falhar, identifique causa raiz.
   - Corrija a menor parte necessária.
   - Repita validação.

6. **Resumir**
   - Liste arquivos alterados.
   - Informe comandos executados e resultado.
   - Aponte próximos passos.

## Critérios de parada

Pare e peça confirmação se:
- precisar apagar dados
- precisar alterar configuração global
- os testes indicarem falha não relacionada
- encontrar segredo/token em arquivo
- houver ambiguidade que possa causar perda de trabalho
