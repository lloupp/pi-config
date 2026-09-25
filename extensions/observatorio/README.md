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
do pi.

Legenda: `○` arquivo, `◇` ferramenta, `!` falha, `✦` seleção. Verde indica arquivo
com alteração bem-sucedida; amarelo indica execução em andamento. As linhas ligam
chamadas recentes: **não são dependências entre arquivos**. Um cometa percorre esse
rastro, da chamada mais antiga para a mais nova; a estrela da última chamada pulsa
(`✧`) e o céu cintila. Tudo isso é efeito visual, não telemetria de rede nem de
progresso interno do modelo.

## Instalar

Vem com o `install-pi-config.sh`. Depois execute `/reload` e `/observatorio`.
Não precisa de bibliotecas, credenciais nem mudanças no `settings.json`. Os imports
são resolvidos pelo próprio pi; não execute `node index.ts` diretamente.

Verificado no pi 0.87.1, num terminal Linux de 140x42 (tmux). O painel ocupa a tela
inteira: quanto maior o terminal, maior o mapa.

## O que é medido (e o que não é)

- Mostra até as **1.000 chamadas mais recentes** do ramo atual. O mapa desenha até
  64 estrelas, as usadas por último, menos em terminais pequenos; todas continuam
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

Animação limitada a 10 quadros/s, somente com o painel aberto; pausa e fechamento
encerram o timer. Sem substituir editor, tema ou rodapé de outras extensões: usa
apenas um pequeno indicador próprio de status. O painel é exclusivo do modo TUI;
print/JSON/RPC não tentam desenhá-lo.

Para desativar, mova a pasta para fora de `extensions/` e execute `/reload`.
