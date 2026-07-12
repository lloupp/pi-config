import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Notifica quando um turno longo do agente termina — útil para largar o
// telefone/PC durante uma tarefa demorada. A notificação carrega só a duração,
// nunca conteúdo da conversa (pode aparecer na tela de bloqueio).

const defaultThresholdMs = 90_000;
const execTimeoutMs = 5000;

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}min ${sec}s` : `${sec}s`;
}

export default function (pi: ExtensionAPI) {
  let enabled = true;
  let thresholdMs = defaultThresholdMs;
  let turnStartedAt: number | undefined;
  // undefined = ainda não detectado; null = nenhum notificador disponível.
  let notifier: "termux" | "notify-send" | null | undefined;

  async function detectNotifier(): Promise<"termux" | "notify-send" | null> {
    if (notifier !== undefined) return notifier;
    const isTermux = (process.env.PREFIX ?? "").includes("com.termux");
    const candidate = isTermux ? "termux-notification" : "notify-send";
    const check = await pi.exec("sh", ["-c", `command -v ${candidate}`], { timeout: execTimeoutMs });
    notifier = check.code === 0 ? (isTermux ? "termux" : "notify-send") : null;
    return notifier;
  }

  async function notify(durationMs: number): Promise<void> {
    const kind = await detectNotifier();
    if (!kind) return;
    const body = `Tarefa concluída (${formatDuration(durationMs)})`;
    if (kind === "termux") {
      await pi.exec("termux-notification", ["-t", "Pi", "-c", body], { timeout: execTimeoutMs });
    } else {
      await pi.exec("notify-send", ["Pi", body], { timeout: execTimeoutMs });
    }
  }

  pi.on("turn_start", async () => {
    turnStartedAt = Date.now();
  });

  pi.on("agent_end", async () => {
    if (!enabled || turnStartedAt === undefined) return;
    const duration = Date.now() - turnStartedAt;
    turnStartedAt = undefined;
    if (duration < thresholdMs) return;
    // Melhor-esforço: falha na notificação nunca vira erro da sessão.
    await notify(duration).catch(() => {});
  });

  pi.registerCommand("notify", {
    description: "Notificação ao fim de tarefas longas. Uso: /notify [on|off|<segundos do limiar>]",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (arg === "on") enabled = true;
      else if (arg === "off") enabled = false;
      else if (arg && Number.isFinite(Number(arg)) && Number(arg) > 0) {
        thresholdMs = Number(arg) * 1000;
        enabled = true;
      } else if (arg) {
        ctx.ui.notify("Uso: /notify [on|off|<segundos do limiar>]", "warning");
        return;
      } else enabled = !enabled;

      const kind = await detectNotifier();
      const via = kind === "termux" ? "termux-notification" : kind === "notify-send" ? "notify-send" : "nenhum notificador disponível";
      ctx.ui.notify(
        `Notify-done: ${enabled ? "ligado" : "desligado"} · limiar ${Math.round(thresholdMs / 1000)}s · via ${via}`,
        "info",
      );
    },
  });
}
