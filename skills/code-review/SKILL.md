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
- bugs lógicos (limites de loop, off-by-one, condições invertidas, null/undefined)
- falhas de segurança (injeção, segredos expostos, validação de input ausente)
- tratamento de erros ausente ou que engole a causa
- problemas de concorrência/estado
- incompatibilidades de ambiente (Termux vs Linux, versões)
- testes faltando nos caminhos de erro

## Saída recomendada
- Resumo curto (1-3 linhas: está seguro para usar/mergear?)
- Achados por severidade, cada um com `arquivo:linha` e o cenário concreto de falha
- Suspeitas a confirmar (separadas)
- Sugestões de patch
- Comandos para validar
