# Lightpanda

Navegador headless para páginas que dependem de JavaScript. O `web_fetch` baixa só o
HTML estático. Aqui a página é executada pelo [Lightpanda](https://lightpanda.io) e
volta como Markdown. Também dá para clicar e preencher campos mantendo a sessão.

**Use `web_fetch` primeiro.** Recorra ao navegador só quando o conteúdo não aparece no
HTML estático ou quando é preciso interagir com a página.

## Tools

| Tool | O que faz |
|---|---|
| `browser_open` | Abre uma URL numa instância isolada e sem estado e devolve Markdown. `waitMs` (padrão 1500, máx. 8000) dá tempo de renderizar; `selector` devolve só o primeiro elemento que casar. |
| `browser_start` | Abre uma sessão interativa nova numa URL. Página, cookies e storage ficam vivos para as tools abaixo. `waitSelector` espera um elemento aparecer. |
| `browser_click` | Clica num seletor CSS e devolve o Markdown atualizado. |
| `browser_fill` | Preenche um campo por seletor CSS e devolve o Markdown atualizado. |
| `browser_close` | Encerra a sessão e descarta página, cookies e storage. |

Há uma sessão interativa por vez: um novo `browser_start` encerra a anterior. Ela também
termina com `browser_close`, `/reload` ou o fim da sessão do pi. A saída é limitada a 12 000 caracteres por padrão (máx. 30 000).

`/lightpanda` mostra o runtime detectado, a versão do binário e se há sessão ativa.

## Instalar

**Linux:** coloque o binário `lightpanda` no PATH.

**Termux:** o binário é Linux, então roda dentro do `proot-distro`, e a extensão
detecta isso sozinha. Instale uma vez:

```bash
pkg install proot-distro
proot-distro install debian
# dentro da debian: instale o binário Linux do Lightpanda no PATH
```

## Variáveis de ambiente

| Variável | Efeito |
|---|---|
| `LIGHTPANDA_BIN` | Caminho de um executável ou wrapper. Força execução direta, inclusive no Termux. |
| `LIGHTPANDA_PROOT_DISTRO` | Distro do `proot-distro` no Termux (padrão `debian`). |
| `LIGHTPANDA_PROOT_BIN` | Comando do Lightpanda dentro da distro (padrão `lightpanda`). |

No Termux, só estas variáveis entram no proot: `LP_*`, `HTTP_PROXY`, `HTTPS_PROXY`,
`ALL_PROXY`, `NO_PROXY`, `LIGHTPANDA_DISABLE_TELEMETRY` e
`LIGHTPANDA_DISABLE_CORE_DUMP`.

## Segurança

- Redes privadas e loopback são bloqueadas pelo próprio Lightpanda
  (`--block-private-networks`), depois da resolução DNS.
- Só aceita `http`/`https`; URL com usuário ou senha embutidos é recusada.
- Todo retorno vem marcado como conteúdo externo não confiável.
- **Segredos em formulários:** defina `LP_SENHA=...` no ambiente e passe `$LP_SENHA` ao
  `browser_fill`. O placeholder é resolvido dentro do processo do Lightpanda, e o valor
  nunca passa pelo modelo.
- Timeouts: 25 s para `browser_open` e 20 s por operação interativa. Cancelar ou estourar
  o tempo encerra a sessão, para nada continuar rodando em segundo plano.
