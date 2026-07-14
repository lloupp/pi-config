# Tema `termux-neon`

Tema customizado do Pi Coding Agent para terminais escuros (Termux/Android e Linux
com fundo escuro). Cores neon (ciano/azul/roxo/verde) sobre fundo azul-marinho profundo.

Arquivo de tema: [`termux-neon.json`](./termux-neon.json)
Ativo em `settings.json`: `"theme": "termux-neon"`

## Paleta base (`vars`)

| Var | Hex | Uso |
|-----|-----|-----|
| `bg` | `#0b1020` | Fundo geral (usado também em `export.pageBg`) |
| `panel` | `#12182a` | Painel de mensagens do usuário / custom (`userMessageBg`, `customMessageBg`) |
| `panel2` | `#182033` | Linha selecionada (`selectedBg`) e `export.infoBg` |
| `cyan` | `#22d3ee` | Accent principal, links, bullets, títulos de tool |
| `blue` | `#60a5fa` | Bordas, URLs de markdown, quote border |
| `purple` | `#a78bfa` | Keywords, rótulo de mensagem custom |
| `green` | `#34d399` | Sucesso, strings, diff added, syntax |
| `red` | `#fb7185` | Erro, diff removed, thinking xhigh |
| `yellow` | `#fbbf24` | Aviso, heading, numbers, thinking high |
| `orange` | `#fb923c` | Variáveis, bash mode |
| `mutedGray` | `#94a3b8` | Texto secundário, contexto de diff |
| `dimGray` | `#64748b` | Texto terciário, bordas sutis |

## Estrutura de tokens

O tema define os 51 tokens obrigatórios do schema
(`dist/modes/interactive/theme/theme-schema.json`) mais a seção opcional `export`
para saída HTML do `/export`:

- **Core UI (11):** accent, border, borderAccent, borderMuted, success, error,
  warning, muted, dim, text, thinkingText
- **Backgrounds & content (11):** selectedBg, userMessageBg, userMessageText,
  customMessageBg, customMessageText, customMessageLabel, toolPendingBg,
  toolSuccessBg, toolErrorBg, toolTitle, toolOutput
- **Markdown (10):** mdHeading, mdLink, mdLinkUrl, mdCode, mdCodeBlock,
  mdCodeBlockBorder, mdQuote, mdQuoteBorder, mdHr, mdListBullet
- **Tool diffs (3):** toolDiffAdded, toolDiffRemoved, toolDiffContext
- **Syntax (9):** syntaxComment, syntaxKeyword, syntaxFunction, syntaxVariable,
  syntaxString, syntaxNumber, syntaxType, syntaxOperator, syntaxPunctuation
- **Thinking levels (6 obrigatórios):** thinkingOff, thinkingMinimal, thinkingLow,
  thinkingMedium, thinkingHigh, thinkingXhigh (+ `thinkingMax`, opcional)
- **Bash mode (1):** bashMode
- **Export (3):** pageBg, cardBg, infoBg

## Tokens intencionalmente vazios (`""`)

`text`, `userMessageText`, `customMessageText`, `toolOutput` e `mdCodeBlock` usam
`""` (cor padrão do terminal). **Decisão deliberada**: mantém portabilidade entre
fundos escuros (Termux) e claros/transparentes (Linux) — fixar uma cor branca
quebraria a legibilidade em um dos ambientes. Não alterar sem motivo.

## Melhorias aprovadas (pendente de aplicação no JSON)

Revisadas com segunda opinião (Nemotron 3 Ultra). Baixo risco; todas reversíveis.

1. **Adicionar `thinkingMax` explícito** (hoje ausente → cai no fallback
   `thinkingXhigh`). Sugestão: `"thinkingMax": "#f472b6"` (rosa neon) ou
   `#ff2d95`, após `thinkingXhigh`. Completa a hierarquia visual
   off → minimal → low → medium → high → xhigh → **max**.
2. **Separar os 4 tokens que hoje compartilham `dimGray` (`#64748b`)** em 3 tons,
   preservando contraste ≥ 4.5:1 contra `#0b1020`:
   - `syntaxComment`: `#5a6a85`
   - `dim`: `#64748b` (mantém)
   - `borderMuted`: `#4a5a7a`
   - `mdCodeBlockBorder`: `#4a5a7a`
3. **Subir `toolDiffContext`** de `mutedGray` (`#94a3b8`, ~3.8:1 contra `panel`)
   para `#a8b5cc` (~5.2:1) — corrige contraste fraco das linhas de contexto em
   diffs de ferramentas. Pode ser inline ou via `var diffContext`.

> Descartado: variante clara (`termux-neon-light.json`) — ambiente do usuário é
> predominantemente escuro; remapear 51 tokens para fundo claro tem alto esforço
> e baixo retorno. O tema `dark` embutido já cobre esse caso.

## Como aplicar alterações no tema

1. Edite [`termux-neon.json`](./termux-neon.json).
2. Valide o JSON:
   ```bash
   python3 -m json.tool themes/termux-neon.json > /dev/null && echo "JSON OK"
   ```
3. No Pi TUI, como `termux-neon` é tema custom ativo, a edição dispara **hot
   reload** — observe se não há erro de carregamento e se as bordas de thinking
   e os diffs ganham a hierarquia esperada.
4. Para persistir no ambiente: copie para `~/.pi/agent/themes/` (ou
   `bash install-pi-config.sh`) e `/reload-pi`. O repo é o espelho em `~/pi-config`.

## Dicas de ajuste

- Comece alterando só uma `var` e referencie-a nos tokens — mantém harmonia.
- Teste com mensagens do usuário, tools (pending/success/error), markdown e texto
  longo quebra linha.
- Em VS Code, `terminal.integrated.minimumContrastRatio: 1` evita correção de cor.
