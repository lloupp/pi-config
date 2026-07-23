# NVIDIA via Alvus — provider opcional para o Pi

A extensão [`nvidia-via-alvus.ts`](./nvidia-via-alvus.ts) registra o provider **`nvidia`**
apontando para o **Alvus** — um proxy Go local, OpenAI-compatible, que fica na frente
da NVIDIA NIM (`https://integrate.api.nvidia.com/v1`) com **pool de chaves** e **retry
silencioso em 429**.

Carregar a extensão é **inofensivo**: ela só registra metadados de provider/modelos, sem
nenhuma chamada de rede no load. Ela só é exercida se você **selecionar** um modelo `nvidia`.
Por isso o `defaultProvider` do repo continua `openrouter` — ambientes sem Alvus não quebram.

## Pré-requisito: subir o Alvus em `127.0.0.1:3000`

1. Clonar e compilar (Go 1.21+):
   ```sh
   git clone https://github.com/lloupp/Alvus.git ~/Alvus
   cd ~/Alvus && go build -o alvus *.go
   ```
2. Criar `~/Alvus/.env` (ao lado do binário) e proteger com `chmod 600 ~/Alvus/.env`:
   ```env
   API_KEYS=nvapi-chave1,nvapi-chave2,nvapi-chave3
   PORT=3000
   TARGET_BASE_URL=https://integrate.api.nvidia.com/v1
   COOLDOWN_SEC=60
   MAX_RETRIES=10
   ```
   Várias chaves no pool multiplicam o RPM efetivo; com uma só, ainda ganha o retry em 429.
3. Rodar `./alvus` (ou como serviço de boot). Validar:
   ```sh
   curl http://127.0.0.1:3000/health
   ```
   Deve retornar `status: ok` com as chaves `ready`.

## Ativar no Pi (opt-in, por ambiente)

Só neste ambiente — **não** mude o `settings.json` do repo (quebraria quem não tem Alvus).
Edite o `settings.json` **instalado** (`~/.pi/agent/settings.json`):
```json
{
  "defaultProvider": "nvidia",
  "defaultModel": "z-ai/glm-5.2"
}
```
Ou, sem mexer no default, por invocação:
```sh
pi --provider nvidia --model z-ai/glm-5.2
```

## Modelos disponíveis

| Modelo                                | Contexto | Reasoning |
| ------------------------------------- | -------- | --------- |
| `z-ai/glm-5.2`                        | 1M       | sim       |
| `deepseek-ai/deepseek-v4-flash`       | 1M       | sim       |
| `qwen/qwen3-next-80b-a3b-instruct`    | 256K     | não       |

Para adicionar/remover modelos, edite a lista `models` em `nvidia-via-alvus.ts`.

## Avisos

- **Sem o Alvus rodando**, não selecione modelos `nvidia` — as chamadas falham.
- A `apiKey` na extensão é um placeholder (`nvapi-alvus-pool`): o Alvus injeta a chave real
  do pool, então a chave enviada pelo cliente é ignorada.
- O Alvus traduz `reasoning_effort` (enviado pelos modelos com reasoning) para o formato de
  "thinking" do NIM; por isso o `qwen3-next-instruct` é marcado `supportsReasoningEffort: false`.
