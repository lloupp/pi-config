import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

interface Snapshot {
  id: number;
  path: string;
  absPath: string;
  existedBefore: boolean;
  /** Buffer, não string: ler/gravar como utf8 corromperia qualquer arquivo não-UTF8. */
  content: Buffer | null;
  /** Arquivo grande demais para guardar: fica registrado, mas não dá para desfazer. */
  tooLarge: boolean;
  toolName: string;
  timestamp: string;
  /** Entrada de sessão que iniciou o turno, alvo do fork ao restaurar a conversa. */
  turnId?: string;
  /** Texto da mensagem do usuário que abriu o turno, para o seletor do /rewind. */
  turnLabel: string;
}

export interface Turn {
  turnId?: string;
  label: string;
  /** Índice do primeiro snapshot do turno em `snapshots`. */
  start: number;
  files: string[];
}

const maxSnapshots = 100;
const maxFileBytes = 1_000_000;

export function pushSnapshot(list: Snapshot[], item: Snapshot, max = maxSnapshots): Snapshot[] {
  const next = [...list, item];
  return next.length > max ? next.slice(-max) : next;
}

/** Agrupa os snapshots por turno, na ordem em que aconteceram. */
export function groupTurns(list: Snapshot[]): Turn[] {
  const turns: Turn[] = [];
  list.forEach((snapshot, index) => {
    const last = turns[turns.length - 1];
    // turnId undefined (sessão sem histórico) não pode fundir turnos distintos: nesse caso
    // cada rótulo diferente abre um grupo novo.
    const sameTurn = last && last.turnId === snapshot.turnId && last.label === snapshot.turnLabel;
    if (sameTurn) {
      if (!last.files.includes(snapshot.path)) last.files.push(snapshot.path);
      return;
    }
    turns.push({ turnId: snapshot.turnId, label: snapshot.turnLabel, start: index, files: [snapshot.path] });
  });
  return turns;
}

/**
 * O que restaurar para voltar ao estado anterior a `start`: por arquivo, o snapshot MAIS
 * ANTIGO a partir dali — é ele que guarda o conteúdo de antes do turno. Os posteriores
 * descrevem estados intermediários e restaurá-los deixaria o arquivo no meio do caminho.
 */
export function planRestore(list: Snapshot[], start: number): Snapshot[] {
  const porArquivo = new Map<string, Snapshot>();
  for (const snapshot of list.slice(start)) {
    if (!porArquivo.has(snapshot.absPath)) porArquivo.set(snapshot.absPath, snapshot);
  }
  return [...porArquivo.values()];
}

export function formatSnapshots(list: Snapshot[], limit = 15): string {
  if (list.length === 0) return "Nenhum checkpoint nesta sessão.";
  return list
    .slice(-limit)
    .reverse()
    .map((s) => {
      const time = s.timestamp.slice(11, 19);
      const kind = s.existedBefore ? "editado" : "criado";
      const note = s.tooLarge ? " — grande demais, sem undo" : "";
      return `#${s.id} ${time} ${s.path} (${kind} via ${s.toolName})${note}`;
    })
    .join("\n");
}

/** Extrai um rótulo curto da mensagem do usuário que abriu o turno. */
function labelOfEntry(entry: any): string | undefined {
  const message = entry?.message;
  if (entry?.type !== "message" || message?.role !== "user") return undefined;
  const content = message.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((block: any) => (typeof block?.text === "string" ? block.text : "")).join(" ")
        : "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}

export default function (pi: ExtensionAPI) {
  let snapshots: Snapshot[] = [];
  let nextId = 1;
  let currentTurn: { turnId?: string; label: string } = { label: "antes do primeiro pedido" };

  // agent_start delimita o pedido do usuário (é onde o pi zera o índice de turnos), que é
  // a unidade do /rewind: voltar "um turno" é voltar ao que existia antes da mensagem.
  pi.on("agent_start", async (_event, ctx) => {
    try {
      const turnId = ctx.sessionManager.getLeafId?.() ?? undefined;
      const label = turnId ? labelOfEntry(ctx.sessionManager.getEntry?.(turnId)) : undefined;
      currentTurn = { turnId, label: label ?? new Date().toTimeString().slice(0, 8) };
    } catch {
      currentTurn = { label: new Date().toTimeString().slice(0, 8) };
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("write", event) && !isToolCallEventType("edit", event)) return undefined;
    const rawPath = event.input.path;
    if (!rawPath) return undefined;
    const cwd = ctx.cwd; // captura antes do await (ctx pode ficar stale ao usar em relative() adiante)
    const absPath = isAbsolute(rawPath) ? rawPath : join(cwd, rawPath);

    // Snapshot é melhor-esforço: qualquer falha aqui nunca deve bloquear a edição.
    try {
      const existedBefore = existsSync(absPath);
      let content: Buffer | null = null;
      let tooLarge = false;
      if (existedBefore) {
        // Arquivo grande demais ainda vira checkpoint (sem conteúdo): assim /checkpoints
        // mostra que aquela edição não tem undo, em vez de o usuário só descobrir na hora.
        tooLarge = statSync(absPath).size > maxFileBytes;
        if (!tooLarge) content = await readFile(absPath);
      }
      snapshots = pushSnapshot(snapshots, {
        id: nextId++,
        path: relative(cwd, absPath) || absPath,
        absPath,
        existedBefore,
        content,
        tooLarge,
        toolName: event.toolName,
        timestamp: new Date().toISOString(),
        turnId: currentTurn.turnId,
        turnLabel: currentTurn.label,
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

  /** Restaura os arquivos ao estado anterior ao turno que começa em `start`. */
  async function restoreFiles(start: number, ctx: any): Promise<{ restored: number; skipped: string[] }> {
    const skipped: string[] = [];
    let restored = 0;

    for (const entry of planRestore(snapshots, start)) {
      if (entry.tooLarge) {
        skipped.push(entry.path);
        continue;
      }
      try {
        if (entry.existedBefore) {
          await mkdir(dirname(entry.absPath), { recursive: true });
          await writeFile(entry.absPath, entry.content ?? Buffer.alloc(0));
        } else if (existsSync(entry.absPath)) {
          await unlink(entry.absPath);
        }
        restored++;
      } catch (error) {
        skipped.push(`${entry.path} (${error instanceof Error ? error.message : String(error)})`);
      }
    }

    snapshots = snapshots.slice(0, start);
    return { restored, skipped };
  }

  pi.registerCommand("rewind", {
    description: "Volta ao estado de um turno anterior: código, conversa ou ambos",
    handler: async (_args, ctx) => {
      const turns = groupTurns(snapshots);
      if (turns.length === 0) {
        ctx.ui.notify("Nada para rebobinar: o agente ainda não editou arquivos nesta sessão.", "warning");
        return;
      }

      // Mais recente primeiro, como no /rewind do Claude Code.
      const recentes = [...turns].reverse().slice(0, 10);
      const rotulos = recentes.map((turn) => {
        const quantos = turn.files.length;
        return `${turn.label} — ${quantos} arquivo${quantos > 1 ? "s" : ""}`;
      });

      const escolha = await ctx.ui.select("Voltar para antes de qual pedido?", [...rotulos, "Cancelar"]);
      if (!escolha || escolha === "Cancelar") return;
      const turn = recentes[rotulos.indexOf(escolha)];
      if (!turn) return;

      const opcoes = ["Código e conversa", "Só o código", "Só a conversa"];
      const oQue = await ctx.ui.select(`Restaurar o quê? (${turn.label})`, [...opcoes, "Cancelar"]);
      if (!oQue || oQue === "Cancelar") return;

      const querCodigo = oQue !== "Só a conversa";
      const querConversa = oQue !== "Só o código";

      if (querConversa && !turn.turnId) {
        ctx.ui.notify(
          "Este turno não tem entrada de sessão registrada, então só o código pode voltar.",
          "warning",
        );
        if (!querCodigo) return;
      }

      const alvo = planRestore(snapshots, turn.start);
      const ok = await ctx.ui.confirm(
        "Rebobinar?",
        [
          querCodigo ? `Arquivos a restaurar (${alvo.length}):\n${alvo.map((s) => `  ${s.path}`).join("\n")}` : "",
          querConversa && turn.turnId ? "A conversa volta para antes desse pedido." : "",
          "",
          "Mudanças feitas depois desse ponto serão perdidas. Continuar?",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      if (!ok) return;

      const partes: string[] = [];
      if (querCodigo) {
        const { restored, skipped } = await restoreFiles(turn.start, ctx);
        partes.push(`${restored} arquivo(s) restaurado(s)`);
        if (skipped.length > 0) partes.push(`não restaurado(s): ${skipped.join(", ")}`);
      }

      if (querConversa && turn.turnId) {
        try {
          // position "before" descarta a mensagem do usuário e tudo o que veio depois.
          await (ctx as any).fork(turn.turnId, { position: "before" });
          partes.push("conversa rebobinada");
        } catch (error) {
          partes.push(`falha ao rebobinar a conversa: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      ctx.ui.notify(partes.join(" · "), "info");
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

      if (entry.tooLarge) {
        ctx.ui.notify(
          `Checkpoint #${entry.id} (${entry.path}) não tem conteúdo guardado: o arquivo passava de ${Math.round(maxFileBytes / 1000)} KB no momento da edição. Não é possível desfazer por aqui.`,
          "warning",
        );
        return;
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
          // Sem encoding: grava os bytes originais de volta, byte a byte.
          await writeFile(entry.absPath, entry.content ?? Buffer.alloc(0));
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
