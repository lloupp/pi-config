import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";

interface MemoryItem {
  id: number;
  scope: "global" | "repo";
  repoKey?: string;
  repoName?: string;
  text: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface MemoryStore {
  nextId: number;
  items: MemoryItem[];
}

const memoryDir = join(homedir(), ".pi", "agent", "memory");
const memoryFile = join(memoryDir, "memories.json");

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

function repoName(cwd: string): string {
  return basename(cwd) || cwd;
}

async function loadStore(): Promise<MemoryStore> {
  if (!existsSync(memoryFile)) return { nextId: 1, items: [] };
  try {
    const parsed = JSON.parse(await readFile(memoryFile, "utf8")) as Partial<MemoryStore>;
    return {
      nextId: Number(parsed.nextId ?? 1),
      items: Array.isArray(parsed.items) ? (parsed.items as MemoryItem[]) : [],
    };
  } catch {
    return { nextId: 1, items: [] };
  }
}

async function saveStore(store: MemoryStore): Promise<void> {
  await mkdir(memoryDir, { recursive: true });
  // Escrita atômica: grava em tmp e renomeia, evitando arquivo parcial/corrompido.
  const tmp = `${memoryFile}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2) + "\n", "utf8");
  await rename(tmp, memoryFile);
}

// Serializa o ciclo load→mutar→save no processo, evitando lost update / nextId colidido.
let writeChain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function score(item: MemoryItem, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const haystack = `${item.text} ${item.tags.join(" ")} ${item.repoName ?? ""}`.toLowerCase();
  if (haystack.includes(q)) return 10 + q.length;
  return q.split(/\s+/).filter((part) => haystack.includes(part)).length;
}

function format(items: MemoryItem[]): string {
  if (items.length === 0) return "Nenhuma memória encontrada.";
  return items
    .map((item) => {
      const scope = item.scope === "repo" ? `repo:${item.repoName ?? item.repoKey}` : "global";
      const tags = item.tags.length ? ` [${item.tags.join(", ")}]` : "";
      return `#${item.id} (${scope})${tags} ${item.text}`;
    })
    .join("\n");
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "persistent_memory",
    label: "Persistent Memory",
    description: "Memória persistente entre sessões. Ações: add, search, list, forget. Não armazene segredos, tokens ou dados sensíveis.",
    promptSnippet: "Salva e consulta preferências, decisões e aprendizados persistentes entre sessões.",
    promptGuidelines: [
      "Use persistent_memory para guardar aprendizados estáveis sobre repositórios, preferências do usuário e decisões recorrentes.",
      "Nunca salve tokens, chaves de API, senhas, conteúdo de .env, dados pessoais sensíveis ou segredos em persistent_memory.",
      "Antes de salvar memória persistente, prefira registrar fatos úteis e estáveis, não detalhes temporários de execução.",
    ],
    parameters: Type.Object({
      action: Type.String({ description: "Ação: add, search, list ou forget" }),
      text: Type.Optional(Type.String({ description: "Texto da memória para add" })),
      query: Type.Optional(Type.String({ description: "Consulta para search" })),
      id: Type.Optional(Type.Number({ description: "ID para forget" })),
      scope: Type.Optional(Type.String({ description: "Escopo: global ou repo. Padrão: repo" })),
      tags: Type.Optional(Type.String({ description: "Tags separadas por vírgula" })),
      limit: Type.Optional(Type.Number({ description: "Limite de resultados" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const currentRepo = ctx.cwd; // captura antes de qualquer await (ctx pode ficar stale)
      const action = String(params.action ?? "list");
      const scope = params.scope === "global" ? "global" : "repo";
      const limit = Math.max(1, Math.min(Number(params.limit ?? 20), 100));

      if (action === "add") {
        const text = String(params.text ?? "").trim();
        if (!text) throw new Error("text é obrigatório para action=add");
        if (/(sk-|token|api[_-]?key|password|senha|secret|-----BEGIN)/i.test(text)) {
          throw new Error("Possível segredo detectado. Não salve credenciais na memória persistente.");
        }

        return withLock(async () => {
          const store = await loadStore();
          const now = new Date().toISOString();
          const item: MemoryItem = {
            id: store.nextId++,
            scope,
            repoKey: scope === "repo" ? currentRepo : undefined,
            repoName: scope === "repo" ? repoName(currentRepo) : undefined,
            text,
            tags: normalizeTags(params.tags),
            createdAt: now,
            updatedAt: now,
          };
          store.items.push(item);
          await saveStore(store);
          return { content: [{ type: "text", text: `Memória salva: #${item.id}` }], details: { item } };
        });
      }

      if (action === "forget") {
        const id = Number(params.id);
        return withLock(async () => {
          const store = await loadStore();
          const before = store.items.length;
          store.items = store.items.filter((item) => item.id !== id);
          await saveStore(store);
          const removed = before - store.items.length;
          return { content: [{ type: "text", text: removed ? `Memória #${id} removida.` : `Memória #${id} não encontrada.` }], details: { id, removed } };
        });
      }

      const store = await loadStore();
      let items = store.items;
      if (scope === "repo") items = items.filter((item) => item.scope === "repo" && item.repoKey === currentRepo);
      else if (params.scope === "global") items = items.filter((item) => item.scope === "global");

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

      return { content: [{ type: "text", text: format(items) }], details: { items, memoryFile } };
    },
  });

  pi.registerCommand("memory", {
    description: "Consulta memória persistente. Uso: /memory [termo]",
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

  pi.registerCommand("remember", {
    description: "Salva memória global. Uso: /remember texto",
    handler: async (args, ctx) => {
      const text = args.trim();
      if (!text) {
        ctx.ui.notify("Uso: /remember texto", "warning");
        return;
      }
      if (/(sk-|token|api[_-]?key|password|senha|secret|-----BEGIN)/i.test(text)) {
        ctx.ui.notify("Possível segredo detectado. Memória não salva.", "error");
        return;
      }
      const id = await withLock(async () => {
        const store = await loadStore();
        const now = new Date().toISOString();
        const item: MemoryItem = { id: store.nextId++, scope: "global", text, tags: [], createdAt: now, updatedAt: now };
        store.items.push(item);
        await saveStore(store);
        return item.id;
      });
      ctx.ui.notify(`Memória salva: #${id}`, "info");
    },
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    // Em fluxos que trocam a sessão (ex.: /plan em modo -p), o ctx deste handler pode já
    // estar stale ao entrar; qualquer acesso lança. Tratamos como "sem injeção neste turno".
    try {
      const cwd = ctx.cwd;
      const store = await loadStore();
      const repoItems = store.items.filter((item) => item.scope === "repo" && item.repoKey === cwd).slice(-8);
      const globalItems = store.items.filter((item) => item.scope === "global").slice(-5);
      const items = [...globalItems, ...repoItems];
      if (items.length === 0) return undefined;

      return {
        message: {
          customType: "persistent-memory-context",
          content: `[MEMÓRIA PERSISTENTE RELEVANTE]\n${format(items)}\n\nUse essas memórias como contexto. Não revele dados sensíveis e não salve segredos.`,
          display: false,
        },
      };
    } catch {
      return undefined;
    }
  });
}
