---
name: self-debate
description: "Debate estruturado para decisões com trade-offs: o agente defende posições opostas, ataca os próprios argumentos e só então decide; para decisões importantes, cada posição pode ser um modelo free diferente via subagent. Use para escolhas de arquitetura, biblioteca, abordagem de refatoração ou qualquer decisão em que a primeira resposta pode estar errada. Roteamento: decidir entre opções = self-debate; planejar/desempacar/revisar com modelo maior = orchestrator."
compatibility: Termux/Android, Linux, qualquer projeto.
---

# Self Debate

Use esta skill quando uma decisão tiver trade-offs reais e a primeira intuição puder estar errada.
O objetivo é evitar ancoragem: gerar alternativas de verdade, atacá-las de verdade e decidir com critérios explícitos.

## Quando usar

- escolha de arquitetura, biblioteca ou ferramenta
- decidir entre refatorar ou corrigir pontualmente
- decisões difíceis de reverter (migrações, formatos de dados, APIs públicas)
- quando o usuário pedir "avalie as opções", "o que é melhor" ou "debata"

Não use para decisões triviais ou já tomadas pelo usuário — nesses casos, apenas execute.

## Processo

### 1. Enquadrar
- Escreva a decisão em uma frase: "Escolher X para Y".
- Liste 2 a 4 critérios que importam neste contexto (ex.: simplicidade, compatibilidade com Termux, custo de manutenção, reversibilidade).
- Colete fatos do projeto antes de opinar (arquivos, versões, restrições). Use `web_search` se faltar informação externa.

### 2. Posições (mínimo 2, ideal 3)
Assuma papéis distintos, um por vez, cada um com o argumento mais forte possível:

- **Advogado**: defende a opção mais promissora com o melhor caso a favor.
- **Cético**: ataca essa opção; aponta riscos, custos ocultos e cenários de falha. Defende a alternativa.
- **Pragmático**: pergunta o que é mais simples, reversível e adequado ao ambiente real (Termux, projeto pequeno, um mantenedor).

Regras do debate:
- cada posição cita evidência concreta (arquivo, comando, fato verificado), não só opinião;
- o Cético é obrigado a achar pelo menos um problema real na opção favorita;
- proibido concluir antes de todas as posições falarem.

### 2b. Debate multi-modelo (opcional, decisões importantes)

Para decisões difíceis de reverter (arquitetura, formato de dados, API pública) e com rede disponível, escale o debate: cada posição vira um modelo free diferente via tool `subagent` (`provider="openrouter"`), para opiniões genuinamente independentes:

- **Advogado** → `model="qwen/qwen3-coder:free"` (ou `nvidia/nemotron-3-super-120b-a12b:free`)
- **Cético** → `model="openai/gpt-oss-120b:free"` (ou `qwen/qwen3-next-80b-a3b-instruct:free`)
- **Pragmático** → você mesmo, o agente principal — é quem conhece o ambiente real.

<!-- IDs confirmados na API pública do OpenRouter (2026-07-11). -->

Regras:
- prompt autocontido por posição: a decisão em uma frase, os critérios do passo 1, os fatos coletados e o papel a assumir ("defenda X com o melhor caso" / "ataque X, aponte riscos");
- nunca inclua segredos no prompt;
- o debate interno continua sendo o **padrão** — multi-modelo só quando a decisão justificar o custo;
- se um modelo falhar (rate limit do tier free), caia para o debate interno na posição faltante — não trave a decisão.

### 3. Rodada de réplica
- O Advogado responde às melhores objeções do Cético.
- Se uma objeção não tiver resposta boa, isso é sinal — não a esconda.

### 4. Julgar
- Compare as opções contra os critérios do passo 1, uma linha por critério.
- Declare a decisão e o principal trade-off aceito.
- Se o debate terminar empatado ou depender de preferência do usuário, apresente as 2 melhores opções e pergunte, em vez de decidir sozinho.

### 5. Registrar
- Resuma a decisão em 2–3 linhas: escolha, motivo, trade-off aceito.
- Para decisões duráveis do projeto, salve em `persistent_memory` (scope repo, tag `decision`).
- Se a decisão vier de um erro anterior, registre também em `error_lessons`.

## Formato de saída

```
Decisão: <uma frase>
Critérios: <lista curta>

Advogado: ...
Cético: ...
Pragmático: ...
Réplica: ...

Julgamento:
- <critério>: <opção vencedora e por quê>
Escolha: <opção> — trade-off aceito: <qual>
```

## Anti-padrões

- debate teatral em que todas as posições concordam;
- posições sem evidência do projeto real;
- estender o debate para decisões pequenas (custa contexto e tempo);
- decidir sozinho algo que é preferência do usuário.
