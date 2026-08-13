---
name: learn-repository
description: Aprende a estrutura, convenções, comandos e decisões importantes de um repositório, salvando conhecimento útil em memória persistente entre sessões. Use ao entrar em um projeto novo, antes de refatorações grandes ou quando o usuário pedir para o agente aprender um repo.
compatibility: Pi no Termux/Android ou Linux, repositórios Git, projetos Node/Python/etc.
---

# Learn Repository

Construa conhecimento durável sobre um repositório e reaproveite em sessões futuras.

## Objetivo

Criar um mapa mental confiável do projeto: propósito, estrutura, comandos,
arquitetura, convenções, pontos sensíveis e decisões do usuário.

Salve apenas fatos estáveis e úteis em `persistent_memory` (scope: repo).

## Segurança de memória

Nunca salve tokens, API keys, senhas, `.env`, `.ssh`, `auth.json` ou dados
pessoais sensíveis. Se encontrar segredo, avise o risco sem repetir o valor.

## Fluxo

0. **Revisar memórias existentes** (se o repo já foi aprendido antes)
   - Consulte `persistent_memory` (search, scope repo) antes de re-aprender do zero.
   - Memória envelhece: **verifique contra a realidade** as que afetam o trabalho.
   - Memória obsoleta é pior que nenhuma (será injetada como verdade): use `forget`
     na errada e salve a versão corrigida.

1. **Snapshot inicial**
   - Use `project_snapshot`.
   - `git status --short` quando aplicável.
   - `git log --oneline -20` — histórico recente revela o que está sendo feito agora.

2. **Arquivos de orientação**
   - Leia `README.md`, `AGENTS.md`, `CLAUDE.md`, docs principais e manifestos
     (`package.json`, `pyproject.toml`, `Cargo.toml`, `Makefile`, CI configs).
   - **Identifique o framework principal** (React, Express, FastAPI, Django, Next.js,
     etc.) logo no snapshot — determina comandos, estrutura e armadilhas esperadas.

3. **Mapa da estrutura**
   - Identifique diretórios principais e responsabilidade de cada um.
   - Use `fd`/`find`/`rg` para investigar sem abrir arquivos demais.

4. **Comandos do projeto**
   - Descubra: instalação, teste, lint, typecheck, build.
   - Não execute comandos pesados sem necessidade; primeiro liste e explique.

5. **Convenções e arquitetura**
   - Identifique padrões de estilo, módulos centrais, pontos de entrada e testes.
   - Prefira fatos verificáveis com caminho de arquivo.

6. **Memorizar**
   Use `persistent_memory` com `scope: "repo"` para salvar itens como:
   - `Projeto X usa npm scripts: test=..., build=...`
   - `Arquitetura: src/api contém..., src/ui contém...`
   - `Convenção: testes ficam em ...`
   - `Cuidado: não editar ... sem ...`
   - Tags: `overview`, `commands`, `architecture`, `testing`, `style`, `security`

7. **Resumo final**
   - mapa curto do repo
   - comandos importantes
   - memórias salvas
   - dúvidas ou próximos passos

## Critérios de qualidade

Uma boa sessão de aprendizado:
- não modifica arquivos
- salva poucas memórias, mas úteis
- cita arquivos que sustentam as conclusões
- deixa comandos de validação claros para futuras tarefas
