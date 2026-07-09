---
name: code-review
description: Revisão de código focada em problemas reais, classificados por severidade, com sugestões pequenas e testáveis. Use quando o usuário pedir revisão, auditoria, refatoração segura ou análise de qualidade.
compatibility: Termux/Android, Linux, projetos de código.
---

# Code Review

Use esta skill quando o usuário pedir revisão, auditoria, refatoração segura ou análise de qualidade.

## Processo
1. Entenda a intenção do projeto ou mudança.
2. Inspecione arquivos relevantes antes de opinar.
3. Priorize achados reais sobre preferências subjetivas.
4. Classifique por severidade: crítico, alto, médio, baixo.
5. Sugira correções pequenas e testáveis.

## Procurar por
- bugs lógicos
- falhas de segurança
- tratamento de erros ausente
- problemas de concorrência/estado
- incompatibilidades de ambiente
- testes faltando

## Saída recomendada
- Resumo curto
- Achados por severidade
- Sugestões de patch
- Comandos para validar
