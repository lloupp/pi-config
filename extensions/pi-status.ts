import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export default function (pi: ExtensionAPI) {
  let turn = 0;

  function updateStatus(ctx: any, extra = "") {
    if (!ctx.hasUI) return;

    const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "modelo?";
    const thinking = pi.getThinkingLevel();
    const cwd = basename(ctx.cwd);
    const text = `${cwd} · ${thinking} · ${model}${extra}`;
    ctx.ui.setStatus("pi-plus", ctx.ui.theme.fg("dim", text));
  }

  pi.on("session_start", async (_event, ctx) => {
    updateStatus(ctx);
    if (ctx.hasUI) {
      ctx.ui.setWorkingIndicator({
        frames: [
          ctx.ui.theme.fg("dim", "·"),
          ctx.ui.theme.fg("muted", "•"),
          ctx.ui.theme.fg("accent", "●"),
          ctx.ui.theme.fg("muted", "•"),
        ],
        intervalMs: 120,
      });
    }
  });

  pi.on("model_select", async (_event, ctx) => updateStatus(ctx));
  pi.on("thinking_level_select", async (_event, ctx) => updateStatus(ctx));

  pi.on("turn_start", async (_event, ctx) => {
    turn += 1;
    updateStatus(ctx, ` · turno ${turn}`);
  });

  pi.on("turn_end", async (_event, ctx) => updateStatus(ctx, ` · ✓ ${turn}`));

  pi.registerCommand("status-pi", {
    description: "Mostra informações rápidas da sessão atual",
    handler: async (_args, ctx) => {
      const usage = ctx.getContextUsage();
      const sessionFile = ctx.sessionManager.getSessionFile() ?? "sessão efêmera";
      const entries = ctx.sessionManager.getEntries().length;
      const activeTools = pi.getActiveTools().join(", ");
      const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "(desconhecido)";

      ctx.ui.notify(
        [
          `Sessão: ${sessionFile}`,
          `Entradas: ${entries}`,
          `Modelo: ${model}`,
          `Thinking: ${pi.getThinkingLevel()}`,
          `Contexto: ${usage ? `${usage.tokens} tokens` : "sem estimativa"}`,
          `Ferramentas: ${activeTools}`,
        ].join("\n"),
        "info",
      );
    },
  });
}
