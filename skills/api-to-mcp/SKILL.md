---
name: api-to-mcp
description: "Procedimento para consumir os endpoints de um site/API e gerar um servidor MCP a partir deles: descobrir o contrato (OpenAPI/docs/sondagem), mapear endpoints em tools, gerar o servidor com fetch e acoplar. Use quando o usuário pedir para transformar uma API ou site em MCP. Para um MCP do zero use mcp-create; para plugar um servidor pronto use mcp-attach."
compatibility: Pi com a extensão mcp e web-tools. Node >= 18 (fetch nativo). Requer acesso à internet.
---

# API → MCP

Transforma endpoints de uma API em tools MCP. A regra de ouro: **confirme cada endpoint com uma chamada real antes de gerar código** — API imaginada é a receita do MCP quebrado.

## Fase 1 — Descobrir o contrato

Em ordem de preferência:
1. **OpenAPI/Swagger**: tente `web_fetch` em `<base>/openapi.json`, `<base>/swagger.json`, `<base>/api-docs`, `<base>/.well-known/openapi.json`. Achou → é a fonte da verdade (paths, params, auth).
2. **Documentação**: `web_search` pela doc oficial da API; extraia endpoints, params e auth.
3. **Sondagem**: só com endpoints que o usuário citou; nunca force-brute paths.

Confirme os 2–3 endpoints mais importantes com chamada real:

```bash
curl -sS -m 15 "<base>/<endpoint>" -H "Accept: application/json" | head -c 500
```

Anote: método, params obrigatórios, formato da resposta, e como autentica (header? query?).

## Fase 2 — Mapear endpoints → tools

- **Selecione** os endpoints úteis à tarefa do usuário — não embrulhe a API inteira (cada tool custa contexto).
- Nome por operação: `get_user`, `list_posts`, `search_items`.
- `inputSchema`: params de path/query/body viram properties; obrigatórios em `required`.
- **Auth e base URL via env** (`API_BASE_URL`, `API_KEY`) — nunca no código. A chave entra no `env` do mcp.json.
- Description de cada tool diz o que retorna, não só o que recebe.

## Fase 3 — Gerar o servidor

Use o template da skill `mcp-create` e escreva os handlers com `fetch`:

```javascript
const BASE = process.env.API_BASE_URL ?? "https://api.exemplo.com";
const KEY = process.env.API_KEY; // não logue este valor

async function apiGet(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: KEY ? { Authorization: `Bearer ${KEY}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${path}`);
  const text = await res.text();
  return text.length > 20000 ? text.slice(0, 20000) + "\n[…truncado]" : text;
}
```

Ajuste o esquema de auth ao que a Fase 1 revelou (header custom, query param). Respostas grandes: trunque sempre — o consumidor é um modelo, não um navegador.

## Fase 4 — Testar e acoplar

1. Teste via pipe (Fase 3 da `mcp-create`) chamando **cada tool com um caso real** e um caso de erro (param faltando, id inexistente).
2. Acople com `mcp-attach`: `command: "node"`, args com caminho absoluto, `env: { "API_BASE_URL": ..., "API_KEY": ... }`.
3. Teste de fumaça no Pi após `/mcp start`.

## Segurança e etiqueta

- Respeite rate limits: sem retry agressivo; um erro 429 → espere, não martele.
- Avise o usuário que os dados dos requests passam pela API de terceiros; não envie dados sensíveis dele em queries.
- API privada → a chave é do usuário e vai no `env` do mcp.json; confirme que esse arquivo não vai para repositório público.
