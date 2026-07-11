---
name: mcp-attach
description: "Procedimento para acoplar qualquer servidor MCP ao Pi: adicionar a entrada no mcp.json com backup, segredos via env, validar o JSON, ligar com /mcp start e testar uma tool. Use quando o usuário pedir para adicionar/plugar/instalar um MCP pronto. Para criar um MCP do zero use mcp-create; para gerar um MCP a partir de uma API use api-to-mcp."
compatibility: Pi com a extensão mcp (extensions/mcp.ts). Termux/Android ou Linux; servidores via npx exigem Node.
---

# MCP Attach

Acoplar um MCP = entrada no `mcp.json` + `/mcp start` (comando do usuário). A extensão `mcp` do setup já faz o transporte; esta skill é o procedimento seguro em volta dela.

## Fase 1 — Identificar o servidor

Descubra: o comando de execução (`npx -y <pacote>`, binário, ou `node script.mjs`), argumentos, e variáveis de ambiente exigidas (chaves de API). Se não souber o pacote exato, confirme com `web_search` — não chute nome de pacote npm.

**Segurança**: um servidor MCP executa código na máquina do usuário. Se a fonte for desconhecida/não-oficial, diga isso explicitamente e peça confirmação antes de prosseguir.

## Fase 2 — Editar o mcp.json (com backup)

Alvo: `~/.pi/agent/mcp.json` (global) ou `.pi/mcp.json` (projeto; sobrepõe por nome).

```bash
cp ~/.pi/agent/mcp.json ~/.pi/agent/mcp.json.bak-$(date +%Y%m%d-%H%M%S) 2>/dev/null || true
```

**Mescle** a nova entrada preservando as existentes:

```json
{
  "mcpServers": {
    "<nome>": {
      "command": "npx",
      "args": ["-y", "<pacote>"],
      "env": { "API_KEY": "<valor>" },
      "enabled": true,
      "timeoutMs": 120000
    }
  }
}
```

Regras:
- **Segredos só em `env`**, nunca em `args`. Se o mcp.json vive num repositório, confirme que o repo é privado ou mova o segredo para variável de ambiente do shell antes de commitar.
- `enabled: false` mantém configurado mas fora do `/mcp start` sem nome.

## Fase 3 — Validar e ligar

```bash
python3 -m json.tool ~/.pi/agent/mcp.json > /dev/null && echo "JSON ok"
```

Peça ao usuário para rodar `/mcp start <nome>` (é comando dele, não seu). O resumo mostra `✓ <nome>: N tools`. Então faça um **teste de fumaça**: chame 1 tool `mcp_<nome>_*` com input simples e confira a resposta.

## Troubleshooting

- Primeiro start com `npx` demora (baixa o pacote); `timeoutMs` de 120000 cobre isso.
- Falha ao conectar → a mensagem da extensão inclui o stderr recente do servidor; leia-o antes de tentar de novo.
- Termux: servidor que baixa binário glibc (Chrome/Playwright etc.) não roda nativo — avise e sugira rodar no Linux.
- Editou o mcp.json com o servidor já ligado → `/mcp reload <nome>`.
- Tool falha com "não está conectado" → o processo caiu; `/mcp reload <nome>` e leia o stderr.
