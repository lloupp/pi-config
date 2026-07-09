---
name: verify
description: "Prova que uma mudança funciona de verdade antes de declarar concluída: executa o fluxo afetado de ponta a ponta e observa o comportamento real, não só testes e typecheck. Use antes de dizer 'pronto', ao entregar qualquer implementação não trivial, ou quando o usuário perguntar 'funciona?'."
compatibility: Termux/Android, Linux, qualquer projeto com superfície executável.
---

# Verify

"Os testes passam" e "funciona" são afirmações diferentes. Testes verificam o que alguém
lembrou de testar; typecheck verifica tipos. Esta skill fecha o buraco: **exercitar o fluxo
real que a mudança afeta e observar o resultado com os próprios olhos** antes de declarar pronto.

## A regra

Nunca diga "pronto", "funciona" ou "corrigido" sem ter executado o comportamento afetado.
Se não for possível executar, diga explicitamente: **"implementei, mas não verifiquei porque X"**.
Essa frase não é fraqueza — é o que separa um relatório confiável de um chute.

## Como verificar, por tipo de mudança

| Tipo | Verificação mínima |
|---|---|
| CLI/script | rode o comando real com input real (e um input inválido) |
| Servidor/API | suba e faça a request do fluxo alterado (`curl`), cheque status e corpo |
| Biblioteca/função | escreva um script mínimo que a importa e chama com casos reais |
| Config (json/yaml/toml) | carregue com o consumidor real ou valide o parse |
| Shell script | `bash -n` (sintaxe) + execute num diretório descartável |
| Skill/prompt/doc | leia como se fosse o leitor-alvo; cheque exemplos executando-os |
| Bug fix | **reproduza o bug antes** do fix (deve falhar) e depois (deve passar) |

## Processo

1. **Identifique o fluxo afetado** — qual comportamento visível esta mudança altera?
2. **Execute o caminho feliz** com dados reais e observe a saída de verdade (não presuma).
3. **Execute um caso de erro** — input inválido, arquivo ausente. Falha bem ou explode?
4. **Cheque efeitos colaterais** — a mudança quebrou algo vizinho? Rode o teste mais
   próximo do que você tocou.
5. **Reporte com evidência**: o comando executado e o que foi observado, não "deve funcionar".

## Armadilhas que esta skill existe para pegar

- **API inventada**: a função/método que você chamou existe mesmo? Se você não a viu
  definida no projeto ou na doc, confirme com `grep`/leitura/`web_search` antes de usar.
- **Teste que passa por não testar nada**: teste novo verde na primeira execução merece
  desconfiança — sabote de propósito (mude o valor esperado) e confirme que ele falha.
- **Funciona no caminho feliz, explode no primeiro erro**: o caso de erro do passo 3 não é opcional.
- **Sucesso declarado por analogia**: "é igual ao outro que funciona" não é verificação.

## Formato do relatório

```
Verificado: <fluxo exercitado>
Comando: <o que foi executado>
Observado: <saída/comportamento real>
Não verificado: <o que ficou de fora e por quê>
```

Se tudo foi verificado, a última linha diz "nada — cobertura completa do fluxo afetado".
