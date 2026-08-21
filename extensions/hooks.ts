// Hooks configuráveis no settings.json, no formato do Claude Code: o usuário decide o que
// roda antes/depois de cada ferramenta sem precisar escrever uma extensão.
//
//   "hooks": {
//     "PostToolUse": [
//       { "matcher": "write|edit", "hooks": [{ "type": "command", "command": "npx prettier --write \"$3\"" }] }
//     ]
//   }
//
// Os valores do evento chegam como PARÂMETROS POSICIONAIS do shell, não interpolados no
// texto do comando: $1 = evento, $2 = ferramenta, $3 = caminho do arquivo (ou o comando
// bash). Interpolar seria injeção — os caminhos vêm do modelo.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type HookEvent = "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop";

export interface HookCommand {
  type?: string;
  command: string;
  /** Timeout em segundos; padrão 60. */
  timeout?: number;
}

export interface HookMatcher {
  /** Regex contra o nome da ferramenta; ausente ou "*" casa com todas. */
  matcher?: string;
  hooks: HookCommand[];
}

const defaultTimeoutMs = 60_000;
const maxOutputChars = 4_000;

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function loadHooks(): Partial<Record<HookEvent, HookMatcher[]>> {
  try {
    const file = join(agentDir(), "settings.json");
    if (!existsSync(file)) return {};
    const hooks = JSON.parse(readFileSync(file, "utf8"))?.hooks;
    return hooks && typeof hooks === "object" ? hooks : {};
  } catch {
    // settings.json inválido não pode derrubar a sessão.
    return {};
  }
}

/** Seleciona os comandos cujo matcher casa com a ferramenta. */
export function selectHooks(groups: HookMatcher[] | undefined, toolName: string): HookCommand[] {
  if (!Array.isArray(groups)) return [];
  const out: HookCommand[] = [];
  for (const group of groups) {
    if (!Array.isArray(group?.hooks)) continue;
    const matcher = group.matcher?.trim();
    if (matcher && matcher !== "*") {
      let re: RegExp;
      try {
        re = new RegExp(`^(?:${matcher})$`, "i");
      } catch {
        continue; // regex inválida: ignora o grupo em vez de estourar
      }
      if (!re.test(toolName)) continue;
    }
    for (const hook of group.hooks) {
      if (hook?.command && (hook.type ?? "command") === "command") out.push(hook);
    }
  }
  return out;
}

/** O terceiro parâmetro: o que o hook mais costuma querer (caminho ou comando). */
export function subjectOf(toolName: string, input: any): string {
  if (toolName === "bash") return String(input?.command ?? "");
  return String(input?.path ?? "");
}

export default function (pi: ExtensionAPI) {
  let config = loadHooks();

  pi.on("session_start", async () => {
    config = loadHooks();
  });

  async function run(event: HookEvent, toolName: string, subject: string, cwd: string) {
    const hooks = selectHooks(config[event], toolName);
    const results: Array<{ code: number; stderr: string; stdout: string }> = [];

    for (const hook of hooks) {
      try {
        const result = await pi.exec("sh", ["-c", hook.command, "pi-hook", event, toolName, subject], {
          cwd,
          timeout: Math.max(1_000, (hook.timeout ?? 60) * 1000) || defaultTimeoutMs,
        });
        results.push({
          code: result.killed ? 124 : (result.code ?? 0),
          stderr: (result.stderr ?? "").trim().slice(0, maxOutputChars),
          stdout: (result.stdout ?? "").trim().slice(0, maxOutputChars),
        });
      } catch (error) {
        results.push({ code: 1, stderr: error instanceof Error ? error.message : String(error), stdout: "" });
      }
    }
    return results;
  }

  pi.on("tool_call", async (event, ctx) => {
    const subject = subjectOf(event.toolName, (event as any).input);
    const results = await run("PreToolUse", event.toolName, subject, ctx.cwd);

    // Convenção do Claude Code: exit code 2 bloqueia, e o stderr vira o motivo mostrado
    // ao modelo. Qualquer outro código diferente de zero é só ruído registrado.
    const blocker = results.find((r) => r.code === 2);
    if (blocker) return { block: true, reason: `Hook PreToolUse bloqueou: ${blocker.stderr || "sem motivo informado"}` };
    return undefined;
  });

  pi.on("tool_result", async (event, ctx) => {
    const toolName = (event as any).toolName ?? "";
    const results = await run("PostToolUse", toolName, "", ctx.cwd);

    // O que o hook escreve em stderr com código 2 volta para o agente, que assim pode
    // corrigir (é o caminho usado por linters e formatadores).
    const feedback = results.filter((r) => r.code === 2 && r.stderr).map((r) => r.stderr);
    if (feedback.length === 0) return undefined;
    return {
      content: [
        ...((event as any).content ?? []),
        { type: "text", text: `Hook PostToolUse:\n${feedback.join("\n")}` },
      ],
    };
  });

  pi.on("input", async (event, ctx) => {
    await run("UserPromptSubmit", "", String(event.text ?? ""), ctx.cwd);
    return { action: "continue" as const };
  });

  pi.on("agent_settled", async (_event, ctx) => {
    await run("Stop", "", "", ctx.cwd);
  });

  pi.registerCommand("hooks", {
    description: "Mostra os hooks configurados no settings.json",
    handler: async (_args, ctx) => {
      config = loadHooks();
      const eventos: HookEvent[] = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop"];
      const linhas = eventos.map((evento) => {
        const grupos = config[evento] ?? [];
        const total = grupos.reduce((soma, g) => soma + (g.hooks?.length ?? 0), 0);
        if (total === 0) return `${evento}: (nenhum)`;
        const detalhe = grupos
          .flatMap((g) => (g.hooks ?? []).map((h) => `    [${g.matcher ?? "*"}] ${h.command}`))
          .join("\n");
        return `${evento}:\n${detalhe}`;
      });
      ctx.ui.notify(
        [
          ...linhas,
          "",
          `Configure em ${join(agentDir(), "settings.json")} na chave "hooks".`,
          'No comando: $1 = evento, $2 = ferramenta, $3 = caminho (ou comando do bash). Ex.: npx prettier --write "$3"',
          "Saída com exit code 2 bloqueia (PreToolUse) ou volta ao agente (PostToolUse).",
        ].join("\n"),
        "info",
      );
    },
  });
}
