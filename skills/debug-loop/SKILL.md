---
name: debug-loop
description: Loop sistemático de depuração: reproduzir, observar, formular hipótese, testar, corrigir e prevenir regressão. Use para bugs, erros de build, testes falhando e comportamento inesperado.
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

## Saída esperada

- Causa raiz
- Arquivos alterados
- Validação executada
- Próxima ação se ainda falhar
