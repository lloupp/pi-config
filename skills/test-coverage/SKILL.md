---
name: test-coverage
description: "Loop para levar a cobertura de testes a 100% (ou ao máximo justificável): medir, encontrar linhas/branches sem cobertura, escrever testes que verificam comportamento real e re-medir até a meta. Use quando o usuário pedir 'cobre com testes', '100% de cobertura', 'aumente a cobertura' ou antes de refatorações arriscadas."
compatibility: Termux/Android, Linux. Node (c8/jest/vitest), Python (pytest-cov), Go (go cover) e similares.
---

# Test Coverage 100%

Use esta skill para aumentar cobertura de testes de forma honesta: cada teste novo deve verificar comportamento real, não apenas executar linhas.

## Regra de ouro (anti-gaming)

Cobertura é o **mapa**, não a meta. Proibido:
- testes sem assert (só para "passar por cima" das linhas);
- assert trivial (`expect(true).toBe(true)`, `assert result is not None` quando dá para verificar o valor);
- copiar a implementação no teste (teste que quebra junto com qualquer mudança legítima);
- excluir código da medição (`/* c8 ignore */`, `# pragma: no cover`) sem justificativa escrita no próprio comentário.

Um teste bom falharia se o comportamento mudasse por engano.

## Loop

### 1. Descobrir a ferramenta
Detecte o ecossistema e o comando de cobertura:

| Ecossistema | Medir cobertura | Relatório com linhas faltantes |
|---|---|---|
| Node (qualquer runner) | `npx c8 npm test` | `npx c8 --reporter=text npm test` |
| Jest | `npx jest --coverage` | `--coverageReporters=text` |
| Vitest | `npx vitest run --coverage` | idem |
| Python | `pytest --cov=<pacote>` | `--cov-report=term-missing` |
| Go | `go test ./... -coverprofile=cover.out` | `go tool cover -func=cover.out` |

Se não houver testes ainda, crie a estrutura mínima primeiro (1 teste que passa) e confirme que o runner funciona antes do loop.

### 2. Medir a baseline
Rode o relatório com linhas faltantes e registre: `X% linhas, Y% branches`. Use `task_list` como ledger:
```
#1 baseline: 62% linhas, 48% branches
#2 cobrir src/parser.ts linhas 40-58 (tratamento de erro)
```

### 3. Priorizar os buracos
Ordem de ataque (maior valor primeiro):
1. **caminhos de erro** (catch, validações, inputs inválidos) — onde bugs se escondem;
2. **branches** não cobertos em código coberto (o if sem o else);
3. **funções públicas** inteiramente sem teste;
4. código morto → não teste: proponha **remover** (cobertura por exclusão honesta).

### 4. Escrever o teste
Para cada buraco:
- leia o código e descubra **qual comportamento** aquela linha implementa;
- escreva o teste pelo comportamento: dado input X, espero Y (incluindo erros: `expect(...).toThrow(...)`);
- casos de borda por tipo: string vazia, lista vazia, zero, negativo, unicode, path com espaço, arquivo inexistente;
- um teste por comportamento; nomes descritivos.

### 5. Re-medir e decidir
- Cobertura subiu e testes verdes → mantenha, atualize o ledger.
- Teste passou mas cobertura não subiu → o teste não exercita o buraco; corrija o teste, não adicione outro por cima.
- Impossível cobrir (ex.: guarda de plataforma, `process.exit`) → marque exclusão **com justificativa no comentário** e conte como resolvido.

### 6. Parar
- **Meta**: 100% de linhas e branches, ou 100% do que restou após exclusões justificadas.
- **Orçamento**: se após ~15 iterações não convergir, entregue o parcial com a lista exata do que falta e por quê.

## Relatório final

```
Cobertura: 62% → 100% (linhas), 48% → 97% (branches)
Testes novos: N em <arquivos>
Exclusões justificadas: <arquivo:linha — motivo>
Como rodar: <comando>
```

## Dicas Termux

- `c8` funciona sem compilação nativa; prefira-o a `nyc` em Node puro.
- Rode o subconjunto de testes do arquivo em edição durante o loop e a suíte completa só no fim de cada iteração — economiza bateria e tempo.
