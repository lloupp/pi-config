---
name: git-workflow
description: Fluxo seguro de git para revisar status e diffs, escrever mensagens de commit e sugerir sequências de comandos. Use quando o usuário pedir ajuda com git, commits, branches, PRs, changelog ou análise de diff.
compatibility: Termux/Android, Linux, repositórios Git.
---

# Git Workflow

Use esta skill quando o usuário pedir ajuda com git, commits, branches, PRs, changelog ou análise de diff.

## Regras
- Sempre verifique `git status --short` antes de orientar mudanças.
- Não sobrescreva mudanças do usuário.
- Evite `git reset --hard` e `git clean -fd` sem confirmação explícita.
- Não faça commit/push sem pedido explícito.

## Fluxo
1. Verificar status.
2. Revisar diff relevante.
3. Explicar mudanças encontradas.
4. Se solicitado, criar mensagem de commit clara.
5. Se solicitado, sugerir sequência segura de comandos.
