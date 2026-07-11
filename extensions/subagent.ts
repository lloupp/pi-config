import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const maxOutputChars = 30_000;
const defaultTimeoutMs = 300_000;
const maxTimeoutMs = 600_000;

// Modo explore: só ferramentas de leitura — o subagente investiga, o agente principal decide e edita.
const exploreTools = ["read", "grep", "find", "ls"];

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Delega uma tarefa a um subagente pi com contexto isolado (processo separado, sem acesso a esta conversa). Modos: explore (padrão, somente leitura — investigar código, responder perguntas sobre o repo) ou full (pode editar e rodar comandos). Aceita provider/model/thinking para rodar com um modelo diferente do padrão (ex.: consultar um modelo maior). Retorna a resposta final do subagente como texto.",
    promptSnippet: "Delega investigações a um subagente com contexto isolado, poupando o contexto principal; aceita modelo alternativo.",
    promptGuidelines: [
      "Use subagent (mode=explore) para buscas amplas e perguntas sobre o código cuja resposta é curta mas exigiria ler muitos arquivos — o contexto gasto fica no subagente.",
      "A tarefa deve ser autocontida: o subagente não vê esta conversa. Inclua caminhos, termos e o formato esperado da resposta.",
      "Use mode=full apenas para tarefas de edição bem definidas e verificáveis; prefira fazer edições importantes você mesmo.",
      "Para consultar um modelo mais forte (planejar, desempacar, revisar), passe provider e model — ex.: provider=openrouter, model=nvidia/nemotron-3-ultra-550b-a55b:free.",
    ],
    parameters: Type.Object({
      task: Type.String({
        description: "Tarefa autocontida para o subagente, com contexto e formato de resposta esperado",
      }),
      mode: Type.Optional(Type.String({ description: "explore (somente leitura, padrão) ou full" })),
      provider: Type.Optional(Type.String({ description: "Provider do modelo (ex.: openrouter); padrão: o da sessão" })),
      model: Type.Optional(Type.String({ description: "ID exato do modelo (ex.: nvidia/nemotron-3-ultra-550b-a55b:free)" })),
      thinking: Type.Optional(Type.String({ description: "Nível de thinking do subagente (ex.: low, medium, high)" })),
      cwd: Type.Optional(Type.String({ description: "Diretório de trabalho; padrão: o atual" })),
      timeoutSec: Type.Optional(Type.Number({ description: "Timeout em segundos, padrão 300" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const task = String(params.task ?? "").trim();
      if (!task) throw new Error("task é obrigatória");
      const mode = params.mode === "full" ? "full" : "explore";
      const timeout = Math.min(Math.max(Number(params.timeoutSec ?? 300) * 1000, 10_000), maxTimeoutMs) || defaultTimeoutMs;

      const args = ["-p", "--no-session"];
      if (mode === "explore") args.push("--tools", exploreTools.join(","));
      if (params.provider) args.push("--provider", String(params.provider));
      if (params.model) args.push("--model", String(params.model));
      if (params.thinking) args.push("--thinking", String(params.thinking));
      args.push(task);

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
        details: { mode, exitCode: result.code, truncated, chars: output.length },
      };
    },
  });
}
