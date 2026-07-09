import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

interface Snapshot {
  id: number;
  path: string;
  absPath: string;
  existedBefore: boolean;
  content: string | null;
  toolName: string;
  timestamp: string;
}

const maxSnapshots = 100;
const maxFileBytes = 1_000_000;

export function pushSnapshot(list: Snapshot[], item: Snapshot, max = maxSnapshots): Snapshot[] {
  const next = [...list, item];
  return next.length > max ? next.slice(-max) : next;
}

export function formatSnapshots(list: Snapshot[], limit = 15): string {
  if (list.length === 0) return "Nenhum checkpoint nesta sessão.";
  return list
    .slice(-limit)
    .reverse()
    .map((s) => {
      const time = s.timestamp.slice(11, 19);
      const kind = s.existedBefore ? "editado" : "criado";
      return `#${s.id} ${time} ${s.path} (${kind} via ${s.toolName})`;
    })
    .join("\n");
}

export default function (pi: ExtensionAPI) {
  let snapshots: Snapshot[] = [];
  let nextId = 1;

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
    const rawPath = String((event.input as any).path ?? "");
    if (!rawPath) return undefined;
    const absPath = isAbsolute(rawPath) ? rawPath : join(ctx.cwd, rawPath);

    // Snapshot é melhor-esforço: qualquer falha aqui nunca deve bloquear a edição.
    try {
      const existedBefore = existsSync(absPath);
      let content: string | null = null;
      if (existedBefore) {
        if (statSync(absPath).size > maxFileBytes) return undefined;
        content = await readFile(absPath, "utf8");
      }
      snapshots = pushSnapshot(snapshots, {
        id: nextId++,
        path: relative(ctx.cwd, absPath) || absPath,
        absPath,
        existedBefore,
        content,
        toolName: event.toolName,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // ignora: melhor editar sem checkpoint do que impedir o trabalho
    }
    return undefined;
  });

  pi.registerCommand("checkpoints", {
    description: "Lista os checkpoints de arquivos desta sessão (estados antes de cada edição do agente)",
    handler: async (_args, ctx) => {
      ctx.ui.notify(formatSnapshots(snapshots), "info");
    },
  });

  pi.registerCommand("undo", {
    description: "Desfaz a última edição do agente em arquivo. Uso: /undo [id] (veja /checkpoints)",
    handler: async (args, ctx) => {
      const arg = args.trim();
      let entry: Snapshot | undefined;
      if (arg) {
        const id = Number(arg);
        entry = snapshots.find((s) => s.id === id);
        if (!entry) {
          ctx.ui.notify(`Checkpoint #${arg} não encontrado. Veja /checkpoints.`, "warning");
          return;
        }
      } else {
        entry = snapshots[snapshots.length - 1];
        if (!entry) {
          ctx.ui.notify("Nenhum checkpoint para desfazer nesta sessão.", "warning");
          return;
        }
      }

      const action = entry.existedBefore
        ? `restaurar ${entry.path} para o estado de ${entry.timestamp.slice(11, 19)}`
        : `apagar ${entry.path} (não existia antes da edição)`;
      const ok = await ctx.ui.confirm(
        "Desfazer edição?",
        `Isto vai ${action}.\n\nMudanças feitas no arquivo depois desse checkpoint serão perdidas. Continuar?`,
      );
      if (!ok) {
        ctx.ui.notify("Undo cancelado.", "info");
        return;
      }

      try {
        if (entry.existedBefore) {
          await mkdir(dirname(entry.absPath), { recursive: true });
          await writeFile(entry.absPath, entry.content ?? "", "utf8");
        } else if (existsSync(entry.absPath)) {
          await unlink(entry.absPath);
        }
        // Checkpoints do mesmo arquivo a partir deste ponto ficam obsoletos após restaurar.
        snapshots = snapshots.filter((s) => s.absPath !== entry.absPath || s.id < entry.id);
        ctx.ui.notify(
          entry.existedBefore ? `Restaurado: ${entry.path}` : `Removido: ${entry.path}`,
          "info",
        );
      } catch (error) {
        ctx.ui.notify(`Falha ao desfazer: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });
}
