import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

async function commandOutput(pi: ExtensionAPI, command: string, args: string[], timeout = 5000) {
  const result = await pi.exec(command, args, { timeout });
  const out = [result.stdout?.trim(), result.stderr?.trim()].filter(Boolean).join("\n");
  return out || `(exit ${result.code})`;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("envcheck", {
    description: "Verifica ferramentas comuns do ambiente Termux",
    handler: async (_args, ctx) => {
      const tools = ["git", "node", "npm", "python", "rg", "fd", "jq", "pkg"];
      const lines: string[] = [`cwd: ${ctx.cwd}`, `PREFIX: ${process.env.PREFIX ?? "(não definido)"}`, ""];

      for (const tool of tools) {
        const result = await pi.exec("sh", ["-lc", `command -v ${tool} >/dev/null 2>&1 && ${tool} --version 2>/dev/null | head -1 || echo ausente`], { timeout: 5000 });
        lines.push(`${tool}: ${(result.stdout || result.stderr).trim()}`);
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("readonly", {
    description: "Ativa modo somente leitura: read, grep, find e ls",
    handler: async (_args, ctx) => {
      pi.setActiveTools(["read", "grep", "find", "ls"]);
      ctx.ui.notify("Modo somente leitura ativado", "info");
    },
  });

  pi.registerCommand("fulltools", {
    description: "Reativa todas as ferramentas disponíveis",
    handler: async (_args, ctx) => {
      pi.setActiveTools(pi.getAllTools().map((tool) => tool.name));
      ctx.ui.notify("Todas as ferramentas disponíveis foram ativadas", "info");
    },
  });

  pi.registerCommand("reload-pi", {
    description: "Recarrega extensões, skills, prompts e temas",
    handler: async (_args, ctx) => {
      await ctx.reload();
      return;
    },
  });

  pi.registerTool({
    name: "project_snapshot",
    label: "Project Snapshot",
    description: "Coleta um resumo curto do projeto atual: diretório, git status e lista de arquivos. Limita a saída para evitar contexto excessivo.",
    promptSnippet: "Coleta um snapshot curto do projeto atual quando precisar entender rapidamente a estrutura.",
    promptGuidelines: [
      "Use project_snapshot quando precisar entender rapidamente a estrutura do projeto antes de uma análise geral.",
    ],
    parameters: Type.Object({
      includeGit: Type.Optional(Type.Boolean({ description: "Incluir git status quando disponível" })),
      maxFiles: Type.Optional(Type.Number({ description: "Máximo de arquivos listados, padrão 80" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const maxFiles = Math.max(1, Math.min(Number(params.maxFiles ?? 80), 200));
      const includeGit = params.includeGit ?? true;

      const parts: string[] = [`cwd: ${ctx.cwd}`];

      if (includeGit) {
        const git = await pi.exec("git", ["status", "--short"], { signal, timeout: 5000 });
        if (git.code === 0) {
          parts.push("\n## git status", git.stdout.trim() || "limpo");
        }
      }

      const fd = await pi.exec("sh", ["-lc", `if command -v fd >/dev/null 2>&1; then fd --type f --max-depth 3 | head -${maxFiles}; else find . -maxdepth 3 -type f | sed 's#^./##' | head -${maxFiles}; fi`], { signal, timeout: 8000 });
      parts.push("\n## arquivos", fd.stdout.trim() || "(nenhum arquivo listado)");

      for (const file of ["package.json", "pyproject.toml", "Cargo.toml", "README.md", "AGENTS.md"]) {
        const out = await commandOutput(pi, "sh", ["-lc", `test -f ${JSON.stringify(file)} && echo encontrado || true`], 3000);
        if (out === "encontrado") parts.push(`\n## marcador\n${file} encontrado`);
      }

      return {
        content: [{ type: "text", text: parts.join("\n") }],
        details: { cwd: ctx.cwd, includeGit, maxFiles },
      };
    },
  });
}
