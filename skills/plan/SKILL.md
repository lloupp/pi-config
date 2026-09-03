---
name: plan
description: "Planejar antes de executar e acompanhar o progresso num arquivo markdown com caixas de seleção, em vez de uma lista efêmera na sessão. Use quando a tarefa for grande, ambígua, tocar vários arquivos, envolver refatoração ou risco de perda de dados, ou quando o usuário pedir análise antes de implementar."
compatibility: qualquer projeto. Precisa apenas de write/edit e um arquivo markdown.
---

# Plan

O plano é **um arquivo**, não um modo. Nada de estado escondido na sessão: o usuário lê o
plano com `cat`, edita no editor dele enquanto você trabalha, e o progresso sobrevive à
queda da sessão porque mora no disco.

Isso torna a lista de tarefas desnecessária como coisa à parte: **um plano com caixas de
seleção já é a lista**. Um arquivo, uma fonte de verdade.

## Quando usar

- a tarefa toca vários arquivos, é ambígua ou é refatoração;
- há risco de perder dados ou quebrar ambiente;
- o usuário pediu análise antes da implementação;
- a tarefa é longa o bastante para você perder o fio no meio.

Tarefa de um passo não precisa de plano. Escrever o arquivo custa mais que fazer.

## O arquivo

Padrão: `PLAN.md` na raiz do projeto. Se o usuário preferir outro lugar, use o dele.

```markdown
# <objetivo em uma linha>

## Contexto
O que descobri lendo o código, e o que ainda não sei.

## Riscos
O que pode dar errado e o que fazer se der.

## Passos
- [ ] 1. <ação> → verifica: <comando ou observação que prova que funcionou>
- [ ] 2. <ação> → verifica: <...>
```

Cada passo carrega a própria verificação. Um passo sem verificação é um desejo, não um
passo.

## Ciclo

1. **Investigue primeiro.** Leia o código antes de escrever o plano. Plano escrito sem
   ler é chute formatado.
2. **Escreva o arquivo** e diga ao usuário onde está, resumindo em duas ou três linhas.
3. **Espere o ok.** Este plano não bloqueia nada — não há gate, não há modo, você
   simplesmente não começa até o usuário responder. Ele pode editar o arquivo antes de
   responder, e o que estiver no arquivo vence o que você propôs.
4. **Execute um passo por vez.** Só o passo atual; nada de adiantar o seguinte.
5. **Marque `- [x]` com `edit` assim que verificar** — depois de rodar a verificação, não
   antes. A marca significa "verifiquei", e é isso que o usuário vai ler.
6. **O plano mudou no meio?** Edite o arquivo e diga o que mudou. Descoberta que altera o
   plano é normal; alterar o plano em silêncio não é.

## Retomada

Sessão nova, contexto perdido, máquina trocada: `cat PLAN.md`. As caixas marcadas dizem
onde você parou. Não existe nada a restaurar além do arquivo.

## Anti-padrões

- **Manter a lista só na conversa.** Ela se perde na compactação e o usuário não a vê.
- **Marcar `[x]` sem rodar a verificação.** Transforma o arquivo em ficção.
- **Plano de vinte passos.** Se não cabe em cinco a oito, o objetivo está grande demais:
  quebre em planos menores ou planeje só a primeira fase.
- **Repetir o plano inteiro na resposta.** O arquivo já é o plano; a resposta diz o que
  mudou desde a última.
- **Deixar `PLAN.md` para trás.** Ao terminar, pergunte se apaga ou se ele vira registro.
