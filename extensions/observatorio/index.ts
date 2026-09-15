import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Observatory, starsFor } from "./model.ts";
import { ObservatoryView } from "./view.ts";

/** Passive, local-only session visualization. No tools, network or file mutations. */
export default function observatorio(pi: ExtensionAPI): void {
  const model = new Observatory("");
  let panel: ObservatoryView | undefined;
  let refresh: (() => void) | undefined;
  let closePanel: (() => void) | undefined;

  const update = (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;
    const files = starsFor(model.calls).filter(star => star.file).length;
    const errors = model.calls.filter(call => call.outcome === "error").length;
    const running = model.calls.some(call => call.outcome === "running");
    ctx.ui.setStatus("observatorio", ctx.ui.theme.fg(errors ? "warning" : "accent", `${running ? "✦" : "○"} ${files} arq · ${model.calls.length} ops${errors ? ` · ${errors}!` : ""}`));
    refresh?.();
  };

  pi.on("session_start", (_event, ctx) => {
    model.rebuild(ctx.sessionManager.getBranch(), ctx.cwd, false);
    update(ctx);
  });
  pi.on("session_tree", (_event, ctx) => {
    // A replay is a snapshot of one branch; close it instead of mixing branches.
    closePanel?.();
    model.rebuild(ctx.sessionManager.getBranch(), ctx.cwd);
    update(ctx);
  });
  pi.on("tool_execution_start", (event, ctx) => {
    model.start(event.toolCallId, event.toolName, event.args, Math.round(performance.now()));
    update(ctx);
  });
  pi.on("tool_execution_end", (event, ctx) => {
    model.finish(event.toolCallId, event.toolName, event.isError, Math.round(performance.now()));
    update(ctx);
  });
  pi.on("agent_end", (_event, ctx) => {
    model.rebuild(ctx.sessionManager.getBranch(), ctx.cwd);
    update(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    closePanel?.();
    panel?.dispose();
    if (ctx.mode === "tui") ctx.ui.setStatus("observatorio", undefined);
  });

  pi.registerCommand("observatorio", {
    description: "Constelação da sessão: arquivos, falhas e replay visual (sem IA extra)",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        if (ctx.hasUI) ctx.ui.notify("O Observatório precisa do terminal interativo do pi.", "info");
        return;
      }
      if (args.trim()) {
        ctx.ui.notify("Use /observatorio. No painel: ↑↓ seleciona, ←→ passo, r replay, v ao vivo, espaço pausa, Esc sai.", "info");
        return;
      }
      if (panel) return;
      try {
        await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
          refresh = () => tui.requestRender();
          const view = new ObservatoryView(model, {
            theme,
            height: () => Math.max(1, Math.floor(tui.terminal.rows * 0.9)),
            redraw: refresh,
            close: () => done(),
          });
          panel = view;
          closePanel = () => { view.dispose(); done(); };
          return view;
        }, {
          overlay: true,
          overlayOptions: { width: "96%", maxHeight: "90%", anchor: "center", margin: 0 },
        });
      } finally {
        panel?.dispose();
        panel = undefined;
        refresh = undefined;
        closePanel = undefined;
      }
    },
  });
}
