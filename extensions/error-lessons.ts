import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";

interface Lesson {
  id: number;
  scope: "global" | "repo";
  repoKey?: string;
  repoName?: string;
  error: string;
  cause?: string;
  lesson: string;
  tags: string[];
  createdAt: string;
}

interface LessonStore {
  nextId: number;
  items: Lesson[];
}

const lessonsDir = join(homedir(), ".pi", "agent", "memory");
const lessonsFile = join(lessonsDir, "lessons.json");
const secretPattern = /(sk-|token|api[_-]?key|password|senha|secret|-----BEGIN)/i;

function repoName(cwd: string): string {
  return basename(cwd) || cwd;
}

function normalizeTags(value: unknown): string[] {
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

async function loadStore(): Promise<LessonStore> {
  if (!existsSync(lessonsFile)) return { nextId: 1, items: [] };
  try {
    const parsed = JSON.parse(await readFile(lessonsFile, "utf8")) as Partial<LessonStore>;
    return {
      nextId: Number(parsed.nextId ?? 1),
      items: Array.isArray(parsed.items) ? (parsed.items as Lesson[]) : [],
    };
  } catch {
    return { nextId: 1, items: [] };
  }
}

async function saveStore(store: LessonStore): Promise<void> {
  await mkdir(lessonsDir, { recursive: true });
  await writeFile(lessonsFile, JSON.stringify(store, null, 2) + "\n", "utf8");
}

function score(item: Lesson, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const haystack = `${item.error} ${item.cause ?? ""} ${item.lesson} ${item.tags.join(" ")} ${item.repoName ?? ""}`.toLowerCase();
  if (haystack.includes(q)) return 10 + q.length;
  return q.split(/\s+/).filter((part) => haystack.includes(part)).length;
}

function format(items: Lesson[]): string {
  if (items.length === 0) return "Nenhuma lição registrada.";
  return items
    .map((item) => {
      const scope = item.scope === "repo" ? `repo:${item.repoName ?? item.repoKey}` : "global";
      const tags = item.tags.length ? ` [${item.tags.join(", ")}]` : "";
      const cause = item.cause ? ` Causa: ${item.cause}.` : "";
      return `#${item.id} (${scope})${tags} Erro: ${item.error}.${cause} Lição: ${item.lesson}`;
    })
    .join("\n");
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "error_lessons",
    label: "Error Lessons",
    description:
      "Registra e consulta lições aprendidas com erros, entre sessões. Ações: add (error, lesson, cause?, tags?, scope?), search (query), list, forget (id). Não armazene segredos.",
    promptSnippet: "Registra lições aprendidas com erros para não repeti-los em sessões futuras.",
    promptGuidelines: [
      "Sempre que um comando falhar de forma não óbvia, uma hipótese se provar errada ou o usuário corrigir seu comportamento, registre uma lição curta com error_lessons (action=add): o que falhou, a causa e como evitar.",
      "Antes de tentar de novo algo que já falhou nesta sessão ou em sessões anteriores, consulte error_lessons (action=search) com um termo do erro.",
      "Registre lições estáveis e acionáveis, não detalhes temporários. Nunca salve tokens, senhas ou conteúdo de arquivos sensíveis.",
    ],
    parameters: Type.Object({
      action: Type.String({ description: "Ação: add, search, list ou forget" }),
      error: Type.Optional(Type.String({ description: "O que falhou (para add)" })),
      cause: Type.Optional(Type.String({ description: "Causa raiz identificada (para add)" })),
      lesson: Type.Optional(Type.String({ description: "Como evitar/resolver da próxima vez (para add)" })),
      query: Type.Optional(Type.String({ description: "Consulta para search" })),
      id: Type.Optional(Type.Number({ description: "ID para forget" })),
      scope: Type.Optional(Type.String({ description: "Escopo: global ou repo. Padrão: repo" })),
      tags: Type.Optional(Type.String({ description: "Tags separadas por vírgula" })),
      limit: Type.Optional(Type.Number({ description: "Limite de resultados" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const store = await loadStore();
      const action = String(params.action ?? "list");
      const scope = params.scope === "global" ? "global" : "repo";
      const limit = Math.max(1, Math.min(Number(params.limit ?? 20), 100));

      if (action === "add") {
        const error = String(params.error ?? "").trim();
        const lesson = String(params.lesson ?? "").trim();
        if (!error || !lesson) throw new Error("error e lesson são obrigatórios para action=add");
        const combined = `${error} ${params.cause ?? ""} ${lesson}`;
        if (secretPattern.test(combined)) {
          throw new Error("Possível segredo detectado. Não salve credenciais nas lições.");
        }

        const item: Lesson = {
          id: store.nextId++,
          scope,
          repoKey: scope === "repo" ? ctx.cwd : undefined,
          repoName: scope === "repo" ? repoName(ctx.cwd) : undefined,
          error,
          cause: params.cause ? String(params.cause).trim() : undefined,
          lesson,
          tags: normalizeTags(params.tags),
          createdAt: new Date().toISOString(),
        };
        store.items.push(item);
        await saveStore(store);
        return { content: [{ type: "text", text: `Lição registrada: #${item.id}` }], details: { item } };
      }

      if (action === "forget") {
        const id = Number(params.id);
        const before = store.items.length;
        store.items = store.items.filter((item) => item.id !== id);
        await saveStore(store);
        const removed = before - store.items.length;
        return { content: [{ type: "text", text: removed ? `Lição #${id} removida.` : `Lição #${id} não encontrada.` }], details: { id, removed } };
      }

      let items = store.items;
      if (params.scope === "global") items = items.filter((item) => item.scope === "global");
      else if (params.scope === "repo") items = items.filter((item) => item.scope === "repo" && item.repoKey === ctx.cwd);

      if (action === "search") {
        const query = String(params.query ?? "").trim();
        items = items
          .map((item) => ({ item, s: score(item, query) }))
          .filter(({ s }) => s > 0)
          .sort((a, b) => b.s - a.s || b.item.id - a.item.id)
          .slice(0, limit)
          .map(({ item }) => item);
      } else {
        items = items.slice().sort((a, b) => b.id - a.id).slice(0, limit);
      }

      return { content: [{ type: "text", text: format(items) }], details: { items, lessonsFile } };
    },
  });

  pi.registerCommand("lessons", {
    description: "Consulta lições aprendidas com erros. Uso: /lessons [termo]",
    handler: async (args, ctx) => {
      const store = await loadStore();
      const query = args.trim();
      const items = store.items
        .map((item) => ({ item, s: score(item, query) }))
        .filter(({ s }) => !query || s > 0)
        .sort((a, b) => b.s - a.s || b.item.id - a.item.id)
        .slice(0, 30)
        .map(({ item }) => item);
      ctx.ui.notify(format(items), "info");
    },
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const store = await loadStore();
    const repoItems = store.items.filter((item) => item.scope === "repo" && item.repoKey === ctx.cwd).slice(-6);
    const globalItems = store.items.filter((item) => item.scope === "global").slice(-4);
    const items = [...globalItems, ...repoItems];
    if (items.length === 0) return undefined;

    return {
      message: {
        customType: "error-lessons-context",
        content: `[LIÇÕES DE ERROS ANTERIORES]\n${format(items)}\n\nEvite repetir esses erros. Se um erro novo relevante acontecer, registre a lição com error_lessons.`,
        display: false,
      },
    };
  });
}
