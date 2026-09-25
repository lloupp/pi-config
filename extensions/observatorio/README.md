# Observatório

Uma constelação viva da sua sessão do pi. Cada caminho acessado vira uma estrela;
chamadas de ferramentas deixam rastros e falhas aparecem em vermelho.
O replay mostra a sequência registrada, sem reexecutar ferramentas.

## Usar

No pi interativo:

```
/reload
/observatorio
```

| Tecla | Ação |
|---|---|
| ↑ / ↓ | Selecionar arquivo ou ferramenta |
| ← / → | Entrar no replay pausado e voltar/avançar uma chamada |
| r | Reiniciar o replay da sessão atual |
| espaço | Pausar/retomar a animação ou o replay |
| v | Voltar à visualização ao vivo |
| Esc ou q | Fechar o painel |

O painel pode ficar aberto enquanto o agente trabalha. Esc dentro do painel fecha
apenas o painel; para interromper o agente, feche o painel e use o comando normal
do pi. No Termux, use as teclas extras para setas/Esc; `q`, `r` e `v` também são
teclas comuns do teclado Android.

Legenda: `○` arquivo, `◇` ferramenta, `!` falha, `✦` seleção. Verde indica arquivo
com alteração bem-sucedida; amarelo indica execução em andamento. As linhas ligam
chamadas recentes: **não são dependências entre arquivos**. O ponto em movimento
é um efeito visual, não telemetria de rede ou de progresso interno do modelo.

## Levar do Termux para um PC Linux

Copie **esta pasta inteira**, incluindo `index.ts`, `model.ts` e `view.ts`, para:

```
~/.pi/agent/extensions/observatorio/
```

Depois execute `/reload` e `/observatorio` no pi do PC. Não precisa instalar
bibliotecas para a extensão, copiar credenciais nem alterar `settings.json`.
Se já existir uma pasta `observatorio` no destino, preserve-a antes de substituir.

Requer Node.js compatível com seu pi e o pacote
`@earendil-works/pi-coding-agent` com as APIs de extensões da versão **0.85.1**.
Os imports são resolvidos pelo próprio pi. Não executar `node index.ts` diretamente.
O código não contém caminhos do Termux nem usa APIs Android. A validação inicial
foi feita no Termux/Android; execução em um PC Linux separado ainda não foi testada.
Distribuições antigas com outro nome de pacote/API não são garantidas.

## O que é medido (e o que não é)

- Mostra até as **1.000 chamadas mais recentes** do ramo atual. O mapa desenha até
  32 estrelas, as usadas por último, menos em telas pequenas; todas continuam
  acessíveis pelas setas. Arquivos da mesma pasta ficam próximos, como uma
  constelação, com o nome da pasta em tom apagado; ferramentas sem caminho formam o
  grupo `ferramentas`. Um nome que não cabe sem cobrir estrelas ou outro nome é
  omitido. A posição não tem outro significado.
- A estrela selecionada mostra suas três últimas chamadas, da mais nova para a mais velha.
- `read`, `edit` e `write` com `path` são agrupados pelo caminho normalizado.
  Outros tools aparecem pelo nome. Não tenta adivinhar arquivos dentro de shell,
  ferramentas remotas ou ferramentas que agrupam outras chamadas.
- “Arquivos” inclui caminhos tentados, inclusive arquivos inexistentes. Leituras
  são tentativas; “alterações OK” conta chamadas `edit`/`write` sem erro, não linhas
  alteradas. Sucesso de uma ferramenta **não prova que o código está correto**.
- Duração só existe para execuções acompanhadas ao vivo, desde o evento de início
  até o evento final (pode incluir espera em confirmações/filas). Não é tempo de CPU.
  Ao recarregar, durações antigas aparecem como indisponíveis.
- Replay avança uma chamada a cada 400 ms: é ordem de chamadas, não reprodução das
  durações. Exibe o resultado conhecido de cada chamada no instante do snapshot.
- `/tree` fecha o painel e reconstrói o ramo escolhido. `/new`, `/resume`, `/fork`
  e `/reload` seguem o ciclo de vida do pi, sem misturar sessões.

## Privacidade e custo

Sem rede, modelos extras, leitura do conteúdo dos arquivos, ferramentas novas,
comandos shell, alterações no projeto ou logs próprios. Só usa os eventos e o
histórico que o pi já possui. Não exibe argumentos de shell, saídas ou texto da
conversa. **Nomes de caminhos aparecem no painel**: evite compartilhá-lo se forem
sensíveis. A extensão não remove informações já armazenadas pelo próprio pi.

Animação limitada a 5 quadros/s, somente com o painel aberto; pausa e fechamento
encerram o timer. Sem substituir editor, tema ou rodapé de outras extensões: usa
apenas um pequeno indicador próprio de status. O painel é exclusivo do modo TUI;
print/JSON/RPC não tentam desenhá-lo.

Para desativar, mova a pasta para fora de `extensions/` e execute `/reload`.
