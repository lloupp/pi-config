import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { Type } from "typebox";

const maxOutputChars = 30_000;
const defaultTimeoutMs = 300_000;
const maxTimeoutMs = 600_000;

export interface AgentType {
  name: string;
  description: string;
  /** Ferramentas liberadas; ausente = todas. */
  tools?: string[];
  model?: string;
  provider?: string;
  thinking?: string;
  /** Corpo do markdown: vira instrução de sistema do subagente. */
  prompt: string;
}

// Tipos embutidos. `explore` é o padrão — o subagente investiga e o agente principal decide
// e edita. As skills orchestrator e self-debate dependem destes dois nomes.
const builtins: Record<string, AgentType> = {
  explore: {
    name: "explore",
    description: "Somente leitura: investiga o código e responde perguntas sobre o repositório",
    tools: ["read", "grep", "find", "ls"],
    prompt: "",
  },
  full: {
    name: "full",
    description: "Pode editar arquivos e rodar comandos",
    prompt: "",
  },
};

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

/** Frontmatter no formato do Claude Code: name, description, tools, model. */
export function parseAgentFile(text: string, fallbackName: string): AgentType | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return undefined;

  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (field) meta[field[1].toLowerCase()] = field[2].trim().replace(/^["']|["']$/g, "");
  }

  const name = meta.name || fallbackName;
  if (!name) return undefined;
  const list = (value?: string) =>
    value
      ? value
          .replace(/^\[|\]$/g, "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined;

  return {
    name,
    description: meta.description || `Subagente ${name}`,
    tools: list(meta.tools),
    model: meta.model || undefined,
    provider: meta.provider || undefined,
    thinking: meta.thinking || undefined,
    prompt: match[2].trim(),
  };
}

/**
 * Descobre os tipos em `agents/*.md`, como os subagent_type do Claude Code. O diretório do
 * projeto tem precedência sobre o global, e os embutidos são o piso.
 */
export function discoverAgents(cwd?: string): Record<string, AgentType> {
  const found: Record<string, AgentType> = { ...builtins };
  const dirs = [join(agentDir(), "agents"), ...(cwd ? [join(cwd, ".pi", "agent", "agents")] : [])];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let files: string[];
    try {
      files = readdirSync(dir).filter((file) => file.endsWith(".md"));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const agent = parseAgentFile(readFileSync(join(dir, file), "utf8"), basename(file, ".md"));
        if (agent) found[agent.name] = agent;
      } catch {
        // Um arquivo quebrado não pode derrubar os demais tipos.
      }
    }
  }
  return found;
}

export default function (pi: ExtensionAPI) {
  const known = discoverAgents();
  const catalogo = Object.values(known)
    .map((agent) => `${agent.name} (${agent.description})`)
    .join("; ");

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Delega uma tarefa a um subagente pi com contexto isolado (processo separado, sem acesso a esta conversa). " +
      `Tipos disponíveis: ${catalogo}. ` +
      "Aceita provider/model/thinking para rodar com um modelo diferente do padrão. Retorna a resposta final como texto.",
    promptSnippet: "Delega investigações a um subagente com contexto isolado, poupando o contexto principal; aceita tipos nomeados e modelo alternativo.",
    promptGuidelines: [
      "Use subagent (subagent_type=explore) para buscas amplas e perguntas sobre o código cuja resposta é curta mas exigiria ler muitos arquivos — o contexto gasto fica no subagente.",
      "A tarefa deve ser autocontida: o subagente não vê esta conversa. Inclua caminhos, termos e o formato esperado da resposta.",
      "Use tipos que podem editar apenas para tarefas bem definidas e verificáveis; prefira fazer edições importantes você mesmo.",
      "Para consultar um modelo mais forte (planejar, desempacar, revisar), passe provider e model.",
    ],
    parameters: Type.Object({
      task: Type.String({
        description: "Tarefa autocontida para o subagente, com contexto e formato de resposta esperado",
      }),
      subagent_type: Type.Optional(
        Type.String({ description: `Tipo de subagente. Padrão: explore. Disponíveis: ${Object.keys(known).join(", ")}` }),
      ),
      mode: Type.Optional(Type.String({ description: "Nome antigo de subagent_type; mantido por compatibilidade" })),
      provider: Type.Optional(Type.String({ description: "Provider do modelo; sobrepõe o do tipo" })),
      model: Type.Optional(Type.String({ description: "ID exato do modelo; sobrepõe o do tipo" })),
      thinking: Type.Optional(Type.String({ description: "Nível de thinking do subagente (ex.: low, medium, high)" })),
      cwd: Type.Optional(Type.String({ description: "Diretório de trabalho; padrão: o atual" })),
      timeoutSec: Type.Optional(Type.Number({ description: "Timeout em segundos, padrão 300" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const task = String(params.task ?? "").trim();
      if (!task) throw new Error("task é obrigatória");

      // Redescobre a cada chamada para enxergar os tipos do projeto atual.
      const agents = discoverAgents(ctx.cwd);
      const wanted = String(params.subagent_type ?? params.mode ?? "explore");
      const agent = agents[wanted];
      if (!agent) {
        throw new Error(`subagent_type desconhecido: ${wanted}. Disponíveis: ${Object.keys(agents).join(", ")}`);
      }

      const timeout = Math.min(Math.max(Number(params.timeoutSec ?? 300) * 1000, 10_000), maxTimeoutMs) || defaultTimeoutMs;

      const args = ["-p", "--no-session"];
      if (agent.tools?.length) args.push("--tools", agent.tools.join(","));
      const provider = params.provider ?? agent.provider;
      const model = params.model ?? agent.model;
      const thinking = params.thinking ?? agent.thinking;
      if (provider) args.push("--provider", String(provider));
      if (model) args.push("--model", String(model));
      if (thinking) args.push("--thinking", String(thinking));

      // O corpo do markdown vira preâmbulo da tarefa: é a forma de dar ao subagente as
      // instruções do tipo sem depender de uma flag de system prompt no CLI.
      args.push(agent.prompt ? `${agent.prompt}\n\n---\n\n${task}` : task);

      const result = await pi.exec("pi", args, {
        signal,
        timeout,
        cwd: params.cwd ? String(params.cwd) : ctx.cwd,
      });

      if (result.killed) {
        throw new Error(`Subagente excedeu o timeout de ${Math.round(timeout / 1000)}s`);
      }

      let output = (result.stdout || "").trim();
      const truncated = output.length > maxOutputChars;
      if (truncated) output = output.slice(0, maxOutputChars) + "\n[…truncado]";

      if (result.code !== 0) {
        const err = (result.stderr || "").trim().slice(0, 2000);
        throw new Error(`Subagente falhou (exit ${result.code}): ${err || output || "sem saída"}`);
      }

      return {
        content: [{ type: "text", text: output || "(subagente terminou sem saída)" }],
        details: { subagentType: agent.name, exitCode: result.code, truncated, chars: output.length },
      };
    },
  });
}
