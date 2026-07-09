---
name: learn-repository
description: Aprende a estrutura, convenções, comandos e decisões importantes de um repositório, salvando conhecimento útil em memória persistente entre sessões. Use ao entrar em um projeto novo, antes de refatorações grandes ou quando o usuário pedir para o agente aprender um repo.
compatibility: Pi no Termux/Android ou Linux, repositórios Git, projetos Node/Python/etc.
---

# Learn Repository

Use esta skill para construir conhecimento durável sobre um repositório e reaproveitar em sessões futuras.

## Objetivo

Criar um mapa mental confiável do projeto:
- propósito do projeto
- estrutura de diretórios
- comandos de setup/test/build/lint
- arquitetura principal
- convenções de código
- pontos sensíveis
- decisões do usuário
- riscos conhecidos

Salve apenas fatos estáveis e úteis em `persistent_memory`.

## Segurança de memória

Nunca salve:
- tokens, API keys, senhas ou secrets
- conteúdo de `.env`, `.ssh`, `auth.json` ou chaves privadas
- dados pessoais sensíveis
- logs com credenciais
- detalhes temporários sem valor futuro

Se encontrar segredo, avise o risco sem repetir o valor.

## Fluxo recomendado

0. **Revisar memórias existentes** (se o repo já foi aprendido antes)
   - Consulte `persistent_memory` (search, scope repo) antes de re-aprender do zero.
   - Memória envelhece: **verifique contra a realidade** as que afetam o trabalho —
     o comando de teste ainda existe no `package.json`? o diretório citado ainda existe?
   - Memória obsoleta é pior que nenhuma (será injetada como verdade): use `forget`
     na errada e salve a versão corrigida.

1. **Snapshot inicial**
   - Use `project_snapshot`.
   - Verifique se é repo Git com `git status --short` quando aplicável.

2. **Arquivos de orientação**
   - Leia `README.md`, `AGENTS.md`, `CLAUDE.md`, docs principais e manifestos:
     - `package.json`
     - `pyproject.toml`
     - `Cargo.toml`
     - `Makefile`
     - arquivos de CI quando úteis

3. **Mapa da estrutura**
   - Identifique diretórios principais e responsabilidade de cada um.
   - Use `fd`/`find`/`rg` para investigar sem abrir arquivos demais.

4. **Comandos do projeto**
   - Descubra comandos de instalação, teste, lint, typecheck e build.
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

7. **Resumo final**
   Entregue:
   - mapa curto do repo
   - comandos importantes
   - memórias salvas
   - dúvidas ou próximos passos

## Tags sugeridas

Ao salvar memórias, use tags como:
- `overview`
- `commands`
- `architecture`
- `testing`
- `style`
- `security`
- `deployment`
- `user-preference`

## Exemplo de uso de memória

- Para salvar aprendizado do repo:
  - action: `add`
  - scope: `repo`
  - tags: `architecture,commands`
  - text: fato curto e estável

- Para consultar depois:
  - action: `search`
  - scope: `repo`
  - query: termo relevante

## Critérios de qualidade

Uma boa sessão de aprendizado:
- não modifica arquivos
- não salva segredos
- salva poucas memórias, mas úteis
- cita arquivos que sustentam as conclusões
- deixa comandos de validação claros para futuras tarefas
