---
name: orchestrator
description: "Consultar um modelo muito mais forte (Nemotron 3 Ultra free) via tool subagent para planejar tarefas complexas, desempacar quando travado (~2 tentativas falhas) e revisar mudanças relevantes. Use quando o usuário pedir para orquestrar, pedir ajuda a um modelo maior, segunda opinião ou usar o nemotron; ou quando a tarefa for complexa/multi-arquivo demais para o modelo padrão. Roteamento: debate interno de opções = self-debate; segunda opinião de modelo maior = orchestrator."
compatibility: Termux/Android ou Linux; requer rede e a extensão subagent com suporte a provider/model.
---

# Orchestrator

Consulte um modelo muito mais forte que o padrão como conselheiro. Sempre via tool
`subagent`.

### Modelos disponíveis (verificado em 2026-08-13)

| Prioridade | Modelo | Provider | Contexto | Notas |
|---|---|---|---|---|
| **1ª (se Alvus ativo)** | `z-ai/glm-5.2` | `nvidia` | 1M | Mais forte disponível — reasoning, 1M contexto. Via Alvus (proxy local NVIDIA NIM) |
| **2ª (free, qualquer máquina)** | `nvidia/nemotron-3-ultra-550b-a55b:free` | `openrouter` | 1M | 550B, free, mais forte do tier free |
| **3ª (free, fallback leve)** | `nvidia/nemotron-3.5-lightning:free` | `openrouter` | 1M | Nemotron 3.5, mais rápido |
| **4ª (free, último recurso)** | `nvidia/nemotron-3-super-120b-a12b:free` | `openrouter` | 262K | 120B, mais leve |

### Como escolher o provider

- **Se o Alvus estiver rodando** (`curl -sS http://127.0.0.1:3000/health` retorna ok):
  use `provider: nvidia`, `model: z-ai/glm-5.2` — é o modelo mais forte e você já tem o pool de chaves.
- **Senão** (ou em máquina sem Alvus): use `provider: openrouter` com `nvidia/nemotron-3-ultra-550b-a55b:free`.

### Modelos free do OpenRouter mudam

Confira IDs antes de atualizar esta skill:
```bash
curl -sS https://openrouter.ai/api/v1/models | python3 -c \
  "import sys,json; [print(m['id']) for m in json.load(sys.stdin)['data'] if ':free' in m['id']]"
```

**Regra de ouro**: o modelo aconselha; quem decide, edita e responde ao usuário é você. Nunca
cole a resposta dele sem avaliar.

## Quando usar

- Tarefa complexa ou multi-arquivo que exige um plano antes de tocar no código.
- Você travou: ~2 tentativas falhas no mesmo problema sem progresso real.
- Mudança relevante concluída que merece revisão antes de declarar pronta.
- O usuário pediu explicitamente ("segunda opinião", "use o nemotron", "orquestre").

## Quando NÃO usar

- Tarefa trivial (1 arquivo, mudança óbvia) — só gasta tempo e rate limit.
- Sem rede disponível.
- O contexto necessário contém segredos (tokens, senhas, dados pessoais) — nunca os envie.
- Debate de opções com trade-offs → use `self-debate`.

## Template de prompt (o subagente não vê esta conversa)

Todo prompt deve ser autocontido:

```
Objetivo: <o que precisa ser resolvido, em 1-2 frases>
Contexto: <fatos relevantes: trechos de código, erro real, estrutura do projeto>
Restrições: <ambiente (Termux?), versões, o que não pode mudar>
Responda com: <formato esperado — lista de passos, diagnóstico, lista de problemas>
```

## Papel 1 — Planejador (antes de tarefa grande)

1. Chame `subagent` com `mode=explore` e o template acima, pedindo: decomposição em subtarefas ordenadas, cada uma com critério de aceitação verificável e riscos conhecidos.
2. Avalie o plano contra o que você sabe do repo; corte o que não se aplica.
3. Registre o plano em `task_list` e **execute você mesmo**, subtarefa por subtarefa.

## Papel 2 — Desempacador (quando travar)

Após ~2 tentativas falhas no mesmo problema:

1. Monte um pacote mínimo autocontido: o erro real (mensagem completa), o trecho de código envolvido, **o que você já tentou e por que falhou**.
2. Peça diagnóstico e o próximo passo mais provável — não "resolva para mim".
3. Aplique o diagnóstico com julgamento próprio; se resolver, registre a causa em `error_lessons`.

## Papel 3 — Revisor (após mudança relevante)

1. Colete `git diff` (ou os arquivos-chave, se o diff for enorme — corte para o essencial).
2. Envie com foco explícito: "aponte bugs, riscos e casos de borda; ignore estilo".
3. Triagem: para cada apontamento, verifique no código real antes de corrigir. Apontamento falso é comum — descarte com motivo.

## Falhas e rate limit

Se a chamada falhar:
1. **Retry** com o mesmo modelo (pode ser transitório).
2. Se havia Alvus e falhou, **caia para OpenRouter free** (nemotron-3-ultra:free).
3. Se OpenRouter free falhar, **caia para o próximo**: lightning → super-120b.
4. Se todos falharem, **siga sozinho** — a skill é aceleração, não dependência.
5. Registre em `error_lessons` para não insistir na mesma sessão.

## Anti-padrões

- Enviar a conversa inteira ou contexto gigante — o prompt deve ser o mínimo autocontido.
- Aplicar a resposta do Nemotron sem verificar no código real.
- Consultar para tarefas triviais ou em loop (consulta atrás de consulta sem executar nada).
- Incluir qualquer segredo no prompt.
