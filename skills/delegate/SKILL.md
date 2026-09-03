---
name: delegate
description: "Delegar uma investigação a um pi separado via bash: a leitura pesada fica no contexto dele e só a resposta volta ao seu. Use para buscas amplas no código cuja resposta é curta — onde mora X, quais arquivos fazem Y, como Z é usado no repo — ou para varreduras que exigiriam ler muitos arquivos."
compatibility: precisa do binário `pi` no PATH e de credencial de provider configurada.
---

# Delegate

Subagente aqui não é uma caixa preta com protocolo próprio: é **o pi rodando via bash**.
Você monta o comando, o usuário vê o comando e vê a saída inteira no terminal. Nada
acontece fora do que está na tela.

O ganho é de contexto, não de inteligência: o subagente lê trinta arquivos e devolve dois
parágrafos. As trinta leituras ficam no contexto dele, não no seu.

## Comando

Explorador somente-leitura — o caso normal:

```bash
pi -p --no-session -ne -ns -t read,grep,find,ls "<tarefa autocontida>"
```

O que cada flag faz e por que está aí:

| flag | efeito |
|---|---|
| `-p` | não interativo: processa e sai |
| `--no-session` | efêmero, não polui o histórico de sessões |
| `-ne` | sem extensões: subagente leve, sem web/checkpoint |
| `-ns` | sem skills, para ele não recarregar tudo isto |
| `-t read,grep,find,ls` | allowlist: sem `write`, `edit` nem `bash`, ele não altera nada |

O `AGENTS.md` continua valendo (não use `-nc`): as regras de honestidade se aplicam ao
subagente também, e é justamente ele que vai te afirmar coisas sobre um código que você
não leu.

Variações:

- **Precisa da web**: tire o `-ne` e libere as tools:
  `-t read,grep,find,ls,web_search,web_fetch`.
- **Precisa escrever**: tire o `--no-session` e libere `write,edit,bash`. Sem
  `--no-session` a sessão fica salva, e você inspeciona depois com `pi --resume` — um
  subagente que altera arquivos precisa deixar rastro legível.
- **Modelo diferente**: `--provider`/`--model`. Não fixe nada aqui; use o que o usuário
  pedir.

## A tarefa precisa ser autocontida

O subagente **não vê esta conversa**. Ele começa do zero, no diretório atual. Escreva a
tarefa como se fosse para alguém que acabou de entrar no projeto:

- ruim: `"veja se aquilo que discutimos afeta o cache"`
- bom: `"neste repo, liste todos os arquivos que leem a variável de ambiente REDIS_URL e
  diga, para cada um, o que acontece quando ela está vazia. Responda em até 10 linhas,
  citando arquivo:linha."`

Peça o formato e o tamanho da resposta. Sem isso vem um ensaio, e o ensaio anula a
economia de contexto que motivou a delegação.

## Quando não delegar

- **A resposta é longa.** Se você precisa do conteúdo dos arquivos, leia você mesmo:
  delegar só acrescenta um intermediário que pode resumir errado.
- **Você já sabe onde olhar.** `grep` direto é mais rápido e mais barato.
- **A tarefa depende do que foi conversado.** Explicar todo o contexto na tarefa custa
  mais que fazer.
- **É a tarefa principal.** Delegar o trabalho central esconde de você o que precisa
  julgar.

## O que o subagente diz é relato, não verdade

Ele pode se enganar sobre o código, e você não viu o que ele viu. Antes de agir sobre um
achado, confirme o essencial — o arquivo:linha que ele citou existe e diz o que ele disse.
Ao repassar o resultado, deixe claro o que veio dele e o que você verificou.
