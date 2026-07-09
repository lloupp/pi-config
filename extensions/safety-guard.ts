import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const destructiveBashPatterns: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\brm\s+(?:-[^\n;|&]*[rf][^\n;|&]*|--recursive|--force)/i, label: "remoção recursiva/forçada" },
  { pattern: /\bgit\s+reset\s+--hard\b/i, label: "git reset --hard" },
  { pattern: /\bgit\s+clean\s+-[^\n;|&]*[fd][^\n;|&]*/i, label: "git clean destrutivo" },
  { pattern: /\b(pkg|apt)\s+(?:remove|purge|uninstall|autoremove)\b/i, label: "remoção de pacotes" },
  { pattern: /\bchmod\s+-R\b/i, label: "chmod recursivo" },
  { pattern: /\bchown\s+-R\b/i, label: "chown recursivo" },
  { pattern: /\bcurl\b[^\n|;]*\|\s*(?:sh|bash)\b/i, label: "curl pipe shell" },
  { pattern: /\bwget\b[^\n|;]*\|\s*(?:sh|bash)\b/i, label: "wget pipe shell" },
];

const protectedPathPatterns: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(^|\/)\.env(?:\.|$)/i, label: "arquivo .env" },
  { pattern: /(^|\/)\.git(?:\/|$)/i, label: "diretório .git" },
  { pattern: /(^|\/)node_modules(?:\/|$)/i, label: "node_modules" },
  { pattern: /(^|\/)\.ssh(?:\/|$)/i, label: "chaves SSH" },
  { pattern: /(^|\/)auth\.json$/i, label: "auth.json" },
];

async function confirmOrBlock(ctx: any, title: string, body: string) {
  if (!ctx.hasUI) return { block: true, reason: `${title}: bloqueado sem UI para confirmação` };

  const ok = await ctx.ui.confirm(title, body);
  if (!ok) return { block: true, reason: "Bloqueado pelo usuário" };
  return undefined;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash") {
      const command = String((event.input as any).command ?? "");
      const match = destructiveBashPatterns.find(({ pattern }) => pattern.test(command));
      if (!match) return undefined;

      return confirmOrBlock(
        ctx,
        `⚠️ Comando perigoso: ${match.label}`,
        `O agente quer executar:\n\n${command}\n\nPermitir?`,
      );
    }

    if (event.toolName === "write" || event.toolName === "edit") {
      const path = String((event.input as any).path ?? "");
      const match = protectedPathPatterns.find(({ pattern }) => pattern.test(path));
      if (!match) return undefined;

      if (ctx.hasUI) ctx.ui.notify(`Proteção: ${path} (${match.label})`, "warning");
      return { block: true, reason: `Caminho protegido: ${path} (${match.label})` };
    }

    return undefined;
  });

  pi.on("user_bash", async (event, ctx) => {
    const match = destructiveBashPatterns.find(({ pattern }) => pattern.test(event.command));
    if (!match) return undefined;

    if (!ctx.hasUI) {
      return {
        result: {
          output: `Bloqueado sem UI para confirmação: ${match.label}`,
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      };
    }

    const ok = await ctx.ui.confirm(
      `⚠️ Comando perigoso: ${match.label}`,
      `Você quer executar:\n\n${event.command}\n\nPermitir?`,
    );

    if (!ok) {
      return {
        result: {
          output: "Bloqueado pelo usuário",
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      };
    }

    return undefined;
  });
}
