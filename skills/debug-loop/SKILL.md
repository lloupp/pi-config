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
   - Se a causa não era óbvia, registre em `error_lessons` (scope repo): o que falhou,
     a causa raiz e como evitar — é o que impede repetir o mesmo debug em outra sessão.

## Saída esperada

- Causa raiz
- Arquivos alterados
- Validação executada
- Lição registrada (quando a causa não era óbvia)
- Próxima ação se ainda falhar
