import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Notifica quando um turno longo do agente termina — útil para largar o
// telefone/PC durante uma tarefa demorada. A notificação carrega só a duração,
// nunca conteúdo da conversa (pode aparecer na tela de bloqueio).

const defaultThresholdMs = 90_000;
const execTimeoutMs = 5000;

function settingsFile(): string {
  return join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "settings.json");
}

function readSettings(): Record<string, any> {
  try {
    return existsSync(settingsFile()) ? (JSON.parse(readFileSync(settingsFile(), "utf8")) ?? {}) : {};
  } catch {
    return {};
  }
}

/** Persiste os ajustes: sem isso eles voltavam ao padrão a cada reload da sessão. */
function persistNotify(enabled: boolean, thresholdSeconds: number): void {
  try {
    const settings = readSettings();
    settings.notify = { ...(settings.notify ?? {}), enabled, thresholdSeconds };
    writeFileSync(settingsFile(), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  } catch {
    // Não poder gravar não impede o ajuste nesta sessão.
  }
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}min ${sec}s` : `${sec}s`;
}

export default function (pi: ExtensionAPI) {
  const stored = readSettings().notify ?? {};
  let enabled = stored.enabled !== false;
  let thresholdMs = Number(stored.thresholdSeconds) > 0 ? Number(stored.thresholdSeconds) * 1000 : defaultThresholdMs;
  let taskStartedAt: number | undefined;
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

  // O marco é o início da tarefa, não do turno: agent_start pode disparar de novo
  // dentro do mesmo run (retry, compactação, continuação enfileirada), então só a
  // primeira marcação vale. Medir por turn_start mediria apenas o último turno e
  // uma tarefa longa feita de turnos curtos nunca cruzaria o limiar.
  pi.on("agent_start", async () => {
    if (taskStartedAt === undefined) taskStartedAt = Date.now();
  });

  // agent_settled (e não agent_end) é o fim de verdade: garante uma notificação por
  // tarefa mesmo quando houve retry ou compactação no meio.
  pi.on("agent_settled", async () => {
    if (taskStartedAt === undefined) return;
    const duration = Date.now() - taskStartedAt;
    taskStartedAt = undefined;
    if (!enabled || duration < thresholdMs) return;
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

      persistNotify(enabled, Math.round(thresholdMs / 1000));
      const kind = await detectNotifier();
      const via = kind === "termux" ? "termux-notification" : kind === "notify-send" ? "notify-send" : "nenhum notificador disponível";
      ctx.ui.notify(
        `Notify-done: ${enabled ? "ligado" : "desligado"} · limiar ${Math.round(thresholdMs / 1000)}s · via ${via}`,
        "info",
      );
    },
  });
}
