import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";

const maxFileBytes = 512_000;
const checkTimeoutMs = 8000;
const maxErrorChars = 800;

function resolvePath(rawPath: string, cwd: string): string {
  return isAbsolute(rawPath) ? rawPath : join(cwd, rawPath);
}

function trimError(text: string): string {
  const t = text.trim();
  return t.length > maxErrorChars ? t.slice(0, maxErrorChars) + "\n[…truncado]" : t;
}

export default function (pi: ExtensionAPI) {
  let enabled = true;

  async function checkCommand(command: string, args: string[]): Promise<string | undefined> {
    const result = await pi.exec(command, args, { timeout: checkTimeoutMs });
    if (result.code === 0 || result.killed) return undefined;
    return trimError(result.stderr || result.stdout || `exit ${result.code}`);
  }

  // .js pode ser CommonJS ou ESM; só reporta erro se falhar nas duas interpretações.
  async function checkJavaScript(absPath: string, ext: string): Promise<string | undefined> {
    if (ext === ".cjs" || ext === ".mjs") return checkCommand("node", ["--check", absPath]);

    const cjsError = await checkCommand("node", ["--check", absPath]);
    if (!cjsError) return undefined;

    const tmpPath = join(tmpdir(), `pi-autocheck-${Date.now()}.mjs`);
    try {
      await writeFile(tmpPath, await readFile(absPath, "utf8"), "utf8");
      const esmError = await checkCommand("node", ["--check", tmpPath]);
      return esmError ? cjsError : undefined;
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  }

  async function checkJson(absPath: string): Promise<string | undefined> {
    try {
      JSON.parse(await readFile(absPath, "utf8"));
      return undefined;
    } catch (error) {
      return trimError(error instanceof Error ? error.message : String(error));
    }
  }

  async function runCheck(absPath: string): Promise<string | undefined> {
    const ext = extname(absPath).toLowerCase();
    switch (ext) {
      case ".js":
      case ".cjs":
      case ".mjs":
        return checkJavaScript(absPath, ext);
      case ".py":
        return checkCommand("python3", ["-m", "py_compile", absPath]);
      case ".sh":
      case ".bash":
        return checkCommand("bash", ["-n", absPath]);
      case ".json":
        return checkJson(absPath);
      default:
        return undefined;
    }
  }

  pi.on("tool_result", async (event, ctx) => {
    if (!enabled || event.isError) return undefined;
    if (event.toolName !== "write" && event.toolName !== "edit") return undefined;

    const rawPath = String(event.input.path ?? "");
    if (!rawPath) return undefined;
    const absPath = resolvePath(rawPath, ctx.cwd);

    // Verificação é melhor-esforço: nunca transforma uma edição boa em erro.
    try {
      if (!existsSync(absPath) || statSync(absPath).size > maxFileBytes) return undefined;
      const error = await runCheck(absPath);
      if (!error) return undefined;

      return {
        content: [
          ...event.content,
          {
            type: "text" as const,
            text: `\n[auto-check] Erro de sintaxe detectado em ${rawPath} após esta edição:\n${error}\nCorrija antes de prosseguir.`,
          },
        ],
      };
    } catch {
      return undefined;
    }
  });

  pi.registerCommand("autocheck", {
    description: "Liga/desliga verificação automática de sintaxe após edições. Uso: /autocheck [on|off]",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (arg === "on") enabled = true;
      else if (arg === "off") enabled = false;
      else enabled = !enabled;
      ctx.ui.notify(`Auto-check: ${enabled ? "ligado" : "desligado"} (js, py, sh, json)`, "info");
    },
  });
}
