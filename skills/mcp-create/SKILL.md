---
name: mcp-create
description: "Procedimento para criar um servidor MCP do zero em Node, sem dependências: definir as tools, gerar a partir do template testado, validar via pipe JSON-RPC e acoplar com mcp-attach. Use quando o usuário pedir para criar/construir um MCP próprio. Para embrulhar uma API existente use api-to-mcp; para plugar um servidor pronto use mcp-attach."
compatibility: Pi com a extensão mcp. Node >= 18. Termux/Android ou Linux.
---

# MCP Create

Cria um servidor MCP stdio mínimo, compatível com o cliente `mcp.ts` deste setup (JSON-RPC 2.0, uma mensagem por linha). O template abaixo foi testado contra o cliente real — parta dele, não de memória.

## Fase 1 — Definir as tools

Com o usuário, defina cada tool: `name` (snake_case), `description` (o modelo escolhe a tool por ela), `inputSchema` (JSON Schema, sempre `type: "object"`) e o que o handler faz. Poucas tools verificáveis > muitas genéricas.

## Fase 2 — Gerar o servidor

Salve como `<nome>-mcp.mjs`. **Regra crítica: stdout é o canal do protocolo — logs SÓ no stderr.**

```javascript
#!/usr/bin/env node
// Servidor MCP mínimo (stdio, sem dependências). Logs SÓ no stderr.
import { createInterface } from "node:readline";

const SERVER = { name: "meu-servidor", version: "1.0.0" };

const TOOLS = [
  {
    name: "somar",
    description: "Soma dois números",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
    handler: async ({ a, b }) => `${a} + ${b} = ${a + b}`,
  },
];

const reply = (id, result) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
const replyError = (id, message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }) + "\n");

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return; // notification: sem resposta

  try {
    if (msg.method === "initialize") {
      reply(msg.id, { protocolVersion: "2025-06-18", serverInfo: SERVER, capabilities: { tools: {} } });
    } else if (msg.method === "tools/list") {
      reply(msg.id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    } else if (msg.method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return replyError(msg.id, `tool desconhecida: ${msg.params?.name}`);
      try {
        const text = await tool.handler(msg.params?.arguments ?? {});
        reply(msg.id, { content: [{ type: "text", text: String(text) }] });
      } catch (err) {
        reply(msg.id, { content: [{ type: "text", text: String(err?.message ?? err) }], isError: true });
      }
    } else {
      replyError(msg.id, `método não suportado: ${msg.method}`);
    }
  } catch (err) {
    process.stderr.write(`erro interno: ${err}\n`);
    replyError(msg.id, "erro interno do servidor");
  }
});
```

Adapte `SERVER` e `TOOLS`. Regras nos handlers: valide inputs; erro de execução → `isError: true` no content (não derrube o processo); operação longa → timeout próprio; nunca escreva segredos nem logs no stdout.

## Fase 3 — Testar SEM o Pi (obrigatório antes de acoplar)

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"somar","arguments":{"a":10,"b":32}}}' \
  | node <nome>-mcp.mjs
```

Espere 3 linhas JSON: initialize com `serverInfo`, a lista de tools, e o resultado da chamada. Teste também uma tool inexistente (deve responder `error`, não travar). Só avance com as 4 respostas corretas.

## Fase 4 — Acoplar

Use a skill `mcp-attach` com `command: "node"`, `args: ["<caminho absoluto>/<nome>-mcp.mjs"]`. Depois do `/mcp start`, faça o teste de fumaça de ponta a ponta.
