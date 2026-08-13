---
name: code-review
description: Revisão de código focada em problemas reais, classificados por severidade, com sugestões pequenas e testáveis. Use quando o usuário pedir revisão, auditoria, refatoração segura ou análise de qualidade.
compatibility: Termux/Android, Linux, projetos de código.
---

# Code Review

Use esta skill quando o usuário pedir revisão, auditoria, refatoração segura ou análise de qualidade.

## Processo
1. Entenda a intenção do projeto ou mudança (leia a descrição, o diff, o contexto).
2. Inspecione arquivos relevantes antes de opinar.
3. Priorize achados reais sobre preferências subjetivas.
4. **Verifique cada achado antes de reportar** (regra anti-falso-positivo abaixo).
5. Classifique por severidade usando os critérios abaixo.
6. Sugira correções pequenas e testáveis.

## Regra anti-falso-positivo (obrigatória)

Falso positivo custa mais que achado perdido: destrói a confiança na revisão.
Antes de reportar um bug:
- **trace o caminho**: leia o código que chama e o que é chamado; confirme que o input
  problemático pode realmente chegar ali;
- descreva o **cenário concreto de falha**: "com input X, acontece Y" — se você não consegue
  descrever o cenário, não é um achado;
- cheque se algo fora do trecho já protege (validação anterior, tipo, teste existente);
- se não conseguiu confirmar mas a suspeita é forte, reporte separado como
  **"suspeita a confirmar"**, nunca misturado aos achados confirmados.

## Critérios de severidade

- **Crítico**: perda/corrupção de dados, vulnerabilidade explorável, quebra total em uso normal.
- **Alto**: bug real em fluxo comum; resultado errado silencioso; crash em caso plausível.
- **Médio**: bug em caso de borda raro; erro engolido sem log; código que induz o próximo bug.
- **Baixo**: legibilidade, nome ruim, duplicação, teste ausente em código estável.

Na dúvida entre dois níveis, use o menor — severidade inflada também é falso positivo.

## Procurar por

### Bugs lógicos
- limites de loop, off-by-one, condições invertidas
- null/undefined/None sem tratamento
- estados impossíveis (enum/machine sem transition guard)

### Segurança (checklist por categoria)

| Categoria | O que procurar |
|---|---|
| **Injeção** | SQL concatenado (não parameterizado), command injection (exec/spawn com input), template injection |
| **Segredos expostos** | API keys/senhas hardcoded ou em config commitado, tokens em logs, `.env` sem `.gitignore` |
| **Validação de input** | input de usuário sem sanitize, path traversal (`../`), SSRF (URL de input sem allowlist) |
| **Auth/session** | compare de senha com `==` em vez de hash seguro, session token previsível, JWT sem verify de signature |
| **XSS** (web) | innerHTML com input de usuário, render de template sem escape, DOM XSS via `document.write` |
| **CSRF** (web) | POST sem CSRF token, mutation via GET, SameSite cookie ausente |
| **Path traversal** (CLI) | `fs.readFile(req.body.path)`, `path.join` sem sanitização de `../`, `open(user_input)` |
| **ReDoS** (regex) | regex catastroficamente retroativa em input de usuário (ex.: `(a+)+` em string longa) |
| **Deps vulneráveis** | `npm audit` / `pip audit` com CVEs não corrigidos, versões desatualizadas com exploits conhecidos |
| **Denial of service** | sem rate limit em endpoint público, parsing de JSON sem limite de tamanho, regex em input sem timeout |

### Concorrência/estado
- race condition (read-modify-write sem lock/atomic)
- deadlock (mutex em ordem inconsistente)
- estado compartilhado sem sincronização

### Tratamento de erros
- catch que engole a causa (`catch {}` ou `except: pass`)
- erro logado sem stack/contexto
- promise sem `.catch()` / async sem try-catch

### Ambiente
- incompatibilidades Termux vs Linux (binários glibc, /tmp, sudo)
- versões de runtime (API deprecada, flag removida)

### Testes
- caminhos de erro sem teste
- mocks que não testam nada real (stub retorna valor fixo, assertion trivial)

## Saída recomendada
- Resumo curto (1-3 linhas: está seguro para usar/mergear?)
- Achados por severidade, cada um com `arquivo:linha` e o cenário concreto de falha
- **Não-achados**: áreas revisadas que não tiveram problemas (ex.: "revisei autenticação — sem_issues"; "deps auditadas — sem CVEs críticos"). Isso é informação útil e evita a pergunta "você chegou a olhar X?".
- Suspeitas a confirmar (separadas)
- Sugestões de patch
- Comandos para validar

## Quando usar auditoria dedicada (`@vigolium/piolium`)

A skills `code-review` cobre revisão manual. Para auditoria multi-fase automatizada
(varredura de deps, análise de fluxo de dados, fuzzing de input), o pacote
`@vigolium/piolium` complementa com subagents especializados:

- **code-review** = revisão de PR/diff por um humano (você, o agente) — rapidos e contextual.
- **piolium** = auditoria sistemática de segurança — multi-fase, retomável, com contexto isolado.

Sugira `piolium` quando:
- o usuário pedir "auditoria de segurança" (não só "revisão");
- o projeto lida com dados sensíveis (auth, pagamentos, PII);
- `code-review` encontrar muitos achados de segurança e quiser validação automatizada;
- antes de um release/tag importante.
