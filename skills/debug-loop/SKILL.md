---
name: debug-loop
description: "Loop sistemático de depuração: reproduzir, observar, formular hipótese, testar, corrigir e prevenir regressão. Use para bugs, erros de build, testes falhando e comportamento inesperado."
compatibility: Termux/Android, Linux, projetos Node/Python/Git.
---

# Debug Loop

## Passos

1. **Reproduzir**
   - Rode o menor comando que mostra o erro.
   - Capture saída relevante, sem despejar logs enormes.

2. **Observar**
   - Leia stack trace e arquivos citados.
   - Verifique versões de runtime quando útil (`node --version`, `python --version`).
   - Consulte `error_lessons` (search) com um termo do erro — pode já ter sido resolvido antes.
   - Se a mensagem de erro for desconhecida, use `web_search` com a parte genérica dela
     (sem caminhos ou nomes locais) — bugs conhecidos de biblioteca quase sempre têm registro.

   **Tabela de erros comuns — onde procurar primeiro:**

   | Erro/sintoma | Procure em |
   |---|---|
   | `EACCES` / `Permission denied` | permissão de arquivo, `chmod`, owner |
   | `MODULE_NOT_FOUND` / `ImportError` | path de import, `node_modules`/venv, versão |
   | `ECONNREFUSED` / `ETIMEDOUT` | serviço não subiu, porta errada, firewall |
   | `SIGILL` (exit 132) | binário incompatível com a CPU (ARM vs x86, SSE4.2) |
   | `SIGSEGV` (exit 139) | segfault — nativo bug ou ABI mismatch |
   | ` ENOENT` | arquivo não encontrado — path relativo vs absoluto |
   | `SyntaxError` inesperado | versão de runtime não suporta a sintaxe |
   | `OSError: [Errno 28]` | disco cheio |
   | comportamento muda sozinho | regressão — use `git bisect` (ver below) |

3. **Hipótese**
   - Declare a causa mais provável.
   - Diga qual evidência confirmaria/refutaria.

4. **Experimento mínimo**
   - Rode um comando ou leia um arquivo para testar a hipótese.
   - Evite editar antes de entender.

5. **Correção mínima**
   - Aplique o menor patch que resolve a causa.
   - Não refatore junto, a menos que seja necessário.

6. **Validação**
   - Reexecute o comando que falhava.
   - Rode teste relacionado.

7. **Prevenção**
   - Sugira teste, assertion ou checagem para evitar regressão.
   - **Para bugs de regressão** (algo parou de funcionar e você não sabe qual commit quebrou):
     use `git bisect start`, `git bisect bad` (atual), `git bisect good <hash>` (último que
     funcionava). O git faz checkout do meio — teste e diga `good`/`bad` até achar o culpado.
     Para automatizar: `git bisect run <script-de-teste>`.
   - Se a causa não era óbvia, registre em `error_lessons` (scope repo): o que falhou,
     a causa raiz e como evitar — é o que impede repetir o mesmo debug em outra sessão.

## Saída esperada

- Causa raiz
- Arquivos alterados
- Validação executada
- Lição registrada (quando a causa não era óbvia)
- Próxima ação se ainda falhar
