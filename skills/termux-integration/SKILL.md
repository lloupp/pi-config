---
name: termux-integration
description: "Procedimento executável para melhorar a integração do Termux com o Android: diagnostica, faz backup, aplica config de teclado (extra-keys com popups, corretor via deslize, enforce-char-based-input) e ativa termux-api. Use quando o usuário pedir para melhorar o teclado, o corretor, os gestos ou a integração do Termux com o celular."
compatibility: Somente Termux/Android. Requer permissão de escrita em ~/.termux.
---

# Termux Integration

Esta é uma skill de **ação**: ao invocá-la, você (agente) executa a melhoria no aparelho do usuário, fase por fase, com verificação em cada uma. Não é um tutorial para colar na resposta.

## Fase 0 — Guarda

Confirme que o ambiente é Termux: `echo $PREFIX` contém `com.termux` (ou existe `/data/data/com.termux`).
Se não for Termux, diga que esta skill só se aplica ao Termux e **pare aqui**.

## Fase 1 — Diagnóstico (só leitura)

Colete e relate o estado atual antes de mudar qualquer coisa:

```bash
ls -la ~/.termux/ 2>/dev/null                 # existe termux.properties?
command -v termux-notification >/dev/null && echo "termux-api: instalado" || echo "termux-api: ausente"
timeout 3 termux-battery-status >/dev/null 2>&1 && echo "app Termux:API: ok" || echo "app Termux:API: sem resposta"
```

## Fase 2 — Backup (obrigatório antes de editar)

Se `~/.termux/termux.properties` existir, faça backup datado antes de qualquer edição:

```bash
mkdir -p ~/.termux
[ -f ~/.termux/termux.properties ] && cp ~/.termux/termux.properties ~/.termux/termux.properties.bak-$(date +%Y%m%d-%H%M%S)
```

Nunca sobrescreva a config do usuário sem backup.

## Fase 3 — Aplicar config de teclado

**Mescle** o bloco abaixo com o arquivo existente: leia o arquivo atual, preserve linhas do usuário que não conflitam, e substitua/adicione somente as propriedades abaixo. Se o arquivo não existir, crie com este conteúdo.

```properties
### Teclado — barra de teclas extra (2 linhas, popups no deslize para cima)
extra-keys = [ \
  [ESC, {key: '/', popup: '|'}, {key: '-', popup: '_'}, HOME, UP, END, PGUP], \
  [TAB, CTRL, ALT, LEFT, DOWN, RIGHT, {key: PGDN, popup: PASTE}] \
]

### Corrige texto que só aparece depois de apertar espaço (Gboard/Samsung)
enforce-char-based-input = true

### Rótulos das teclas extras em minúsculas
extra-keys-text-all-cap = false

### Sino do terminal vibra em vez de apitar
bell-character = vibrate
```

Regras da sintaxe (não invente além disso): cada tecla especial (CTRL, ALT, FN, ESC) no máximo **uma vez** na definição; popups usam `{key: X, popup: Y}`; macros usam `{macro: "CTRL x", display: "rótulo"}`; continuação de linha com `\`.

Aplique e confirme:

```bash
termux-reload-settings
```

Depois **pergunte ao usuário** se a barra de teclas mudou na tela — você não consegue ver a tela; a confirmação visual é dele.

## Fase 4 — Ensinar os gestos (explique ao usuário, curto)

- **Deslizar a barra de teclas para a ESQUERDA** abre um campo de texto onde o teclado Android funciona completo: **corretor, sugestões e ditado por voz**. Ideal para escrever prompts longos em português; Enter envia ao terminal. Deslize de volta para retornar às teclas.
- **Deslizar uma tecla para CIMA** aciona o popup dela (ex.: `/` vira `|`).

## Fase 5 — Integração Android via termux-api (opcional — pergunte antes)

Se o diagnóstico mostrou `termux-api: ausente`, ofereça instalar:

```bash
pkg install termux-api
```

Avise: o **app Termux:API** (F-Droid/GitHub, não Play Store) também precisa estar instalado no Android; sem ele os comandos `termux-*` travam. Depois teste:

```bash
termux-notification -t "Pi" -c "Integração funcionando" && echo ok
```

Mencione o que fica disponível: `termux-speech-to-text` (ditar prompts por voz), `termux-clipboard-get/set`, `termux-wake-lock` (impede o Android de matar tarefas longas), `termux-open-url`.

## Fase 6 — Relatório final

Entregue: o que foi alterado (propriedades aplicadas), caminho do backup criado, resultado do teste de notificação (se feito), e o que o usuário ainda precisa confirmar visualmente (barra nova, popups, deslize para a esquerda). Seja honesto sobre o que você não pôde verificar sem ver a tela.

## Se o usuário quiser mais

- **Unexpected Keyboard** (F-Droid, `juloo.keyboard2`): teclado feito para terminal — Ctrl/Esc/setas e símbolos por deslize nas próprias teclas.
- **Hacker's Keyboard**: layout completo com F1–F12 e setas.
- Teclado físico: atalhos como `shortcut.create-session = ctrl + t` no `termux.properties`.

## Troubleshooting

- Mudança não teve efeito → rodou `termux-reload-settings`? Se sim, feche e reabra a sessão.
- Texto só aparece após espaço → `enforce-char-based-input = true` (já aplicado na Fase 3) e reabra o Termux.
- Comando `termux-*` trava sem resposta → o app Termux:API não está instalado; não adianta tentar de novo.
- Barra de teclas sumiu → deslize a barra para a direita (você está no campo de texto) ou verifique erro de sintaxe no `extra-keys` (restaure o backup e reaplique).
