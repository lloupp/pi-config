import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

// Modelo do TodoWrite do Claude Code: a lista inteira é reenviada a cada chamada, e cada
// tarefa carrega a forma ativa do verbo ("Migrando o checkpoint") usada enquanto ela roda.
type TaskStatus = "pending" | "in_progress" | "completed";
interface Task {
  content: string;
  activeForm: string;
  status: TaskStatus;
}
interface TaskDetails {
  tasks: Task[];
  error?: string;
}

const readonlyTools = ["read", "grep", "find", "ls", "project_snapshot"];

// Bash NÃO é filtrado por allowlist no modo plano — mesmo modelo do plan mode do Claude
// Code: bloqueia-se a escrita de arquivos e confia-se na instrução do prompt somada ao
// safety-guard, que já intercepta comandos destrutivos.
//
// A allowlist anterior falhava nas duas direções: deixava passar execução de código
// arbitrário (`npm run <script>`, `node arquivo.js`, `pip install`) enquanto barrava
// investigação legítima, já que qualquer pipe caía no filtro de metacaracteres — nem
// `git log --oneline | head -5` passava.

// As opções do ExitPlanMode do Claude Code: aprovar escolhe em que modo de permissão a
// sessão continua. "Editar plano" não existe lá, mas é útil e não conflita — fica no fim.
type GateChoice = "approve-auto" | "approve-manual" | "edit" | "reject";
const gateOptions: { label: string; value: GateChoice }[] = [
  { label: "Sim, e aceitar edições automaticamente", value: "approve-auto" },
  { label: "Sim, aprovar cada edição", value: "approve-manual" },
  { label: "Não, continuar planejando", value: "reject" },
  { label: "Editar plano", value: "edit" },
];

// Gate de aprovação com o plano rolável (padrão do question.ts oficial): o título do
// ctx.ui.select é estático e um plano longo estoura a tela do Termux sem scroll.
// ↑↓/j/k rolam o plano; PgUp/PgDn/g/G saltam; ←→/Tab trocam a opção; Enter confirma;
// 1-3 escolhem direto; Esc rejeita.
async function planGate(ctx: ExtensionContext, plan: string, fileRel: string): Promise<GateChoice> {
  if (ctx.mode !== "tui") {
    // Sem TUI completa (ex.: RPC): cai no select simples com preview truncado.
    const lines = plan.split(/\r?\n/);
    const preview = lines.length > 40 ? lines.slice(0, 40).join("\n") + `\n… (íntegra em ${fileRel})` : plan;
    const choice = await ctx.ui.select(`Plano proposto (${fileRel}):\n\n${preview}\n\nPronto para implementar?`, gateOptions.map((o) => o.label));
    return gateOptions.find((o) => o.label === choice)?.value ?? "reject";
  }

  const result = await ctx.ui.custom<GateChoice | null>((tui, theme, _kb, done) => {
    const planLines = plan.split(/\r?\n/);
    const windowSize = 12;
    let offset = 0;
    let optionIndex = 0;
    let maxOffset = 0; // recalculado no render (depende da largura p/ wrap)
    let cached: string[] | undefined;

    function refresh() {
      cached = undefined;
      tui.requestRender();
    }

    function handleInput(data: string) {
      if (matchesKey(data, Key.up) || data === "k") { offset = Math.max(0, offset - 1); refresh(); return; }
      if (matchesKey(data, Key.down) || data === "j") { offset = Math.min(maxOffset, offset + 1); refresh(); return; }
      if (matchesKey(data, Key.pageUp) || data === "u") { offset = Math.max(0, offset - windowSize); refresh(); return; }
      if (matchesKey(data, Key.pageDown) || data === "d") { offset = Math.min(maxOffset, offset + windowSize); refresh(); return; }
      if (matchesKey(data, Key.home) || data === "g") { offset = 0; refresh(); return; }
      if (matchesKey(data, Key.end) || data === "G") { offset = maxOffset; refresh(); return; }
      if (matchesKey(data, Key.left)) { optionIndex = (optionIndex + gateOptions.length - 1) % gateOptions.length; refresh(); return; }
      if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) { optionIndex = (optionIndex + 1) % gateOptions.length; refresh(); return; }
      if (data >= "1" && data <= String(gateOptions.length)) { done(gateOptions[Number(data) - 1].value); return; }
      if (matchesKey(data, Key.enter)) { done(gateOptions[optionIndex].value); return; }
      if (matchesKey(data, Key.escape)) { done(null); return; }
    }

    function render(width: number): string[] {
      if (cached) return cached;
      const w = Math.max(20, width);
      const wrapped = planLines.flatMap((l) => wrapTextWithAnsi(l || " ", w - 2));
      maxOffset = Math.max(0, wrapped.length - windowSize);
      if (offset > maxOffset) offset = maxOffset;
      const visible = wrapped.slice(offset, offset + windowSize);

      const lines: string[] = [];
      lines.push(theme.fg("accent", "─".repeat(w)));
      lines.push(theme.fg("accent", theme.bold(` Plano proposto (${fileRel})`)));
      lines.push("");
      for (const l of visible) lines.push(` ${l}`);
      if (wrapped.length > windowSize) {
        lines.push(theme.fg("dim", ` — linhas ${offset + 1}-${offset + visible.length} de ${wrapped.length} (↑↓ rolam) —`));
      }
      lines.push("");
      for (let i = 0; i < gateOptions.length; i++) {
        const sel = i === optionIndex;
        const marker = sel ? theme.fg("accent", "→ ") : "  ";
        const label = `${i + 1}. ${gateOptions[i].label}`;
        lines.push(` ${marker}${sel ? theme.fg("accent", label) : theme.fg("text", label)}`);
      }
      lines.push("");
      lines.push(theme.fg("dim", " ↑↓ rolar • ←→ opção • Enter confirmar • 1-3 direto • Esc rejeitar"));
      lines.push(theme.fg("accent", "─".repeat(w)));
      cached = lines;
      return lines;
    }

    return {
      render,
      invalidate: () => {
        cached = undefined;
      },
      handleInput,
    };
  });

  return result ?? "reject";
}

function cloneTasks(tasks: Task[]) {
  return tasks.map((task) => ({ ...task }));
}

const statusMark: Record<TaskStatus, string> = { pending: "☐", in_progress: "▶", completed: "☒" };

function renderTasks(tasks: Task[]) {
  if (tasks.length === 0) return "Sem tarefas.";
  // A tarefa em andamento aparece na forma ativa, como no Claude Code.
  return tasks
    .map((t) => `${statusMark[t.status]} ${t.status === "in_progress" ? t.activeForm : t.content}`)
    .join("\n");
}

/**
 * Normaliza e valida a lista inteira. O invariante do TodoWrite é uma única tarefa em
 * andamento: mais de uma é erro devolvido ao modelo, e nenhuma é legítima só quando não
 * sobrou nada pendente.
 */
export function normalizeTasks(raw: unknown): { tasks: Task[]; error?: string } {
  if (!Array.isArray(raw)) return { tasks: [], error: "todos precisa ser uma lista" };

  const tasks: Task[] = [];
  for (const item of raw) {
    const content = String((item as any)?.content ?? "").trim();
    if (!content) return { tasks: [], error: "cada tarefa precisa de content" };
    const status = String((item as any)?.status ?? "pending") as TaskStatus;
    if (!(status in statusMark)) {
      return { tasks: [], error: `status inválido: ${status} (use pending, in_progress ou completed)` };
    }
    tasks.push({ content, activeForm: String((item as any)?.activeForm ?? "").trim() || content, status });
  }

  const running = tasks.filter((t) => t.status === "in_progress");
  if (running.length > 1) {
    return { tasks: [], error: `apenas uma tarefa pode estar in_progress; vieram ${running.length}` };
  }
  if (running.length === 0 && tasks.some((t) => t.status === "pending")) {
    return { tasks: [], error: "marque como in_progress a tarefa que você está fazendo agora" };
  }
  return { tasks };
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export default function (pi: ExtensionAPI) {
  let planMode = false;
  let activeBeforePlan: string[] | undefined;
  let tasks: Task[] = [];
  let planFilePath: string | undefined; // absoluto — único caminho gravável no modo plano
  let planFileRel = ".pi/plans/plano.md"; // para mensagens legíveis
  let lastCtx: ExtensionContext | undefined; // handlers do barramento não recebem ctx

  function readPlan() {
    if (planFilePath && existsSync(planFilePath)) return readFileSync(planFilePath, "utf8");
    return "";
  }

  function writePlan(content: string) {
    if (!planFilePath) return;
    mkdirSync(dirname(planFilePath), { recursive: true });
    writeFileSync(planFilePath, content, "utf8");
  }

  // Diretório onde os planos vivem; a escrita no modo plano é liberada só aqui dentro.
  function plansDir(ctx: ExtensionContext) {
    return resolve(ctx.cwd, ".pi", "plans");
  }

  // True se `abs` é um arquivo DENTRO de .pi/plans/ (não o próprio dir, sem escapar via ..).
  function isInsidePlans(ctx: ExtensionContext, abs: string): boolean {
    const rel = relative(plansDir(ctx), abs);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  }

  // Persiste o estado do plano na sessão para sobreviver a retomadas (resume).
  function persistPlanState(ctx: ExtensionContext) {
    try {
      const slug = planFilePath ? basename(planFilePath, ".md") : undefined;
      pi.appendEntry("plan-tasks-state", { planMode, slug, planFileRel });
    } catch {
      /* sessão sem persistência disponível */
    }
  }

  // Restaura planFilePath/planFileRel e, se estava em modo plano, reativa o bloqueio de escrita.
  function restorePlanState(ctx: ExtensionContext) {
    const entries = ctx.sessionManager.getEntries();
    let found: { planMode?: boolean; slug?: string; planFileRel?: string } | undefined;
    for (const e of entries) {
      const entry = e as any;
      if (entry.type === "custom" && entry.customType === "plan-tasks-state") found = entry.data;
    }
    if (!found) return;
    planFileRel = found.planFileRel || planFileRel;
    if (found.slug) planFilePath = resolve(ctx.cwd, ".pi", "plans", `${found.slug}.md`);
    if (found.planMode) {
      planMode = true;
      if (activeBeforePlan === undefined) activeBeforePlan = pi.getActiveTools();
      pi.setActiveTools(planTools());
    }
    updatePlanUi(ctx);
  }

  // Reabre um plano salvo em .pi/plans/<slug>.md para revisão/implementação.
  function openPlan(ctx: ExtensionContext, slug?: string) {
    if (!slug) {
      ctx.ui.notify("Uso: /open-plan <slug>  (liste com /plans)", "warning");
      return;
    }
    const clean = slug.replace(/\.md$/, "");
    const target = resolve(ctx.cwd, ".pi", "plans", `${clean}.md`);
    if (!isInsidePlans(ctx, target)) {
      ctx.ui.notify(`Slug inválido: ${slug} — o plano deve ficar dentro de .pi/plans/ (sem barras nem "..").`, "error");
      return;
    }
    if (!existsSync(target)) {
      ctx.ui.notify(`Plano não encontrado: ${clean} (.pi/plans/${clean}.md)`, "error");
      return;
    }
    if (!planMode) activeBeforePlan = pi.getActiveTools();
    planMode = true;
    planFilePath = target;
    planFileRel = relative(ctx.cwd, target) || `${clean}.md`;
    mkdirSync(dirname(target), { recursive: true });
    pi.setActiveTools(planTools());
    updatePlanUi(ctx);
    persistPlanState(ctx);
    const content = readPlan();
    pi.sendUserMessage(
      `Reabrindo plano salvo em ${planFileRel}. O conteúdo atual está abaixo — revise, amplie ou ajuste e mantenha os passos numerados. ` +
      `Não edite outros arquivos. Quando estiver pronto, chame exit_plan para aprovar/implementar.\n\n---\n${content}`,
      { deliverAs: "followUp" },
    );
  }

  // Cria tarefas a partir das linhas numeradas de nível superior do plano (1. ... / 1) ...).
  function seedTasksFromPlan(content: string) {
    const items: string[] = [];
    for (const raw of content.split(/\r?\n/)) {
      const m = raw.match(/^\s*\d+[.)]\s+(.+\S)\s*$/);
      if (m) items.push(m[1].trim());
    }
    if (items.length === 0) return 0;
    // A primeira já entra em andamento, para respeitar o invariante de uma ativa. O
    // activeForm sai igual ao texto do passo; o agente reescreve no gerúndio na primeira
    // atualização da lista.
    tasks = items.map((text, i) => ({
      content: text,
      activeForm: text,
      status: i === 0 ? "in_progress" : "pending",
    }));
    return items.length;
  }

  function reconstructTasks(ctx: ExtensionContext) {
    tasks = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message as any;
      if (msg.role !== "toolResult" || msg.toolName !== "task_list") continue;
      const details = msg.details as TaskDetails | undefined;
      if (!details?.tasks) continue;
      tasks = cloneTasks(details.tasks);
    }
  }

  function updatePlanUi(ctx: ExtensionContext) {
    if (!ctx?.hasUI) return;
    // Ligado ao theme, não desestruturado: fg usa `this` internamente e um `const { fg }`
    // estoura com "Cannot read properties of undefined (reading 'fgColors')".
    const fg = (color: string, text: string) => ctx.ui.theme.fg(color as any, text);

    if (planMode) {
      ctx.ui.setStatus("plan-tasks", fg("warning", "📋 plan"));
      ctx.ui.setWidget("plan-tasks", [
        fg("warning", "Modo plano ativo"),
        fg("dim", `Escrita bloqueada (exceto ${planFileRel}). Chame exit_plan ou use /implement.`),
      ]);
      return;
    }

    ctx.ui.setStatus("plan-tasks", undefined);

    // Fora do modo plano o widget passa a ser a lista de tarefas, viva enquanto o agente
    // trabalha — é o que torna o task_list um TodoWrite e não um bloco de notas.
    if (tasks.length === 0) {
      ctx.ui.setWidget("plan-tasks", undefined);
      return;
    }
    const done = tasks.filter((t) => t.status === "completed").length;
    ctx.ui.setWidget("plan-tasks", [
      fg("accent", `Tarefas (${done}/${tasks.length})`),
      ...tasks.map((t) => {
        const line = `${statusMark[t.status]} ${t.status === "in_progress" ? t.activeForm : t.content}`;
        if (t.status === "completed") return fg("dim", line);
        return t.status === "in_progress" ? fg("accent", line) : line;
      }),
    ]);
  }

  // Ferramentas do modo plano: mantém write/edit NO schema para que o agente possa gravar
  // o arquivo de plano; o bloqueio de outras gravações é feito pelo guard em tool_call,
  // não removendo as ferramentas (senão a exceção do arquivo de plano vira código morto).
  function planTools() {
    const set = new Set<string>([...readonlyTools, ...pi.getActiveTools()]);
    set.add("write");
    set.add("edit");
    return [...set];
  }

  function enablePlan(ctx: ExtensionContext, objective?: string) {
    if (planMode && !objective) return; // já ativo: nada a refazer (evita perder o plano aberto)
    if (!planMode) activeBeforePlan = pi.getActiveTools();
    planMode = true;
    const slug = slugify(objective ?? "") || "plano";
    planFilePath = resolve(ctx.cwd, ".pi", "plans", `${slug}.md`);
    planFileRel = relative(ctx.cwd, planFilePath) || `${slug}.md`;
    // Sem mkdir aqui: agora que o modo plano entra pelo Shift+Tab, criar o diretório na
    // ativação deixaria um .pi/plans/ vazio em todo projeto onde alguém ciclasse os modos.
    // writePlan já cria sob demanda.
    pi.setActiveTools(planTools());
    updatePlanUi(ctx);
    persistPlanState(ctx);
    if (ctx.hasUI) ctx.ui.notify("Modo plano ativo: gravação permitida só no arquivo de plano; demais escritas bloqueadas.", "info");
  }

  function disablePlan(ctx: ExtensionContext) {
    if (!planMode) return;
    planMode = false;
    if (activeBeforePlan) pi.setActiveTools(activeBeforePlan);
    activeBeforePlan = undefined;
    updatePlanUi(ctx);
    persistPlanState(ctx);
  }

  /**
   * O modo plano é um dos modos de permissão (permissions.ts), como no Claude Code. Quem
   * manda no estado é aquela extensão: aqui só se pede a troca e se reage ao anúncio.
   * A comunicação é pelo pi.events porque o loader cria um jiti por extensão, então um
   * módulo compartilhado viraria duas instâncias em vez de um singleton.
   */
  function requestMode(mode: "plano" | "perguntar" | "aceitar-edicoes") {
    pi.events.emit("permissions:set-mode", { mode });
  }

  pi.events.on("permissions:mode", (data: any) => {
    const ctx = lastCtx;
    if (!ctx) return;
    if (data?.mode === "plano") enablePlan(ctx);
    else disablePlan(ctx);
  });

  // Aprova o plano: libera escrita, semeia tarefas a partir do arquivo. Retorna nº de tarefas.
  function approve(ctx: ExtensionContext, nextMode: "perguntar" | "aceitar-edicoes" = "perguntar") {
    const count = seedTasksFromPlan(readPlan());
    disablePlan(ctx);
    requestMode(nextMode);
    if (ctx.hasUI) {
      const modo = nextMode === "aceitar-edicoes" ? "aceitando edições automaticamente" : "confirmando cada edição";
      ctx.ui.notify(
        count > 0
          ? `Implementando, ${modo}. ${count} tarefa(s) criadas a partir do plano.`
          : `Implementando, ${modo}.`,
        "info",
      );
    }
    return count;
  }

  // Injeta a mensagem que efetivamente inicia a implementação (novo turno do agente).
  // Sem isso, o modelo tende a encerrar o turno após o tool result do exit_plan.
  function sendImplementPrompt(count: number, extra?: string) {
    const extraText = extra?.trim() ? `\nInstruções extras: ${extra.trim()}` : "";
    pi.sendUserMessage(
      `Plano aprovado. Implemente em passos pequenos, atualizando o task_list a cada passo: ` +
        `uma tarefa em in_progress por vez, marcada completed assim que terminar. ` +
        `${count > 0 ? `Foram criadas ${count} tarefas a partir do plano.` : ""} Rode validações quando possível.${extraText}`,
      { deliverAs: "followUp" },
    );
  }

  pi.on("session_start", async (_event, ctx) => {
    lastCtx = ctx;
    reconstructTasks(ctx);
    restorePlanState(ctx);
    updatePlanUi(ctx);
    // Se a sessão foi retomada em modo plano, o ciclo de permissões precisa concordar.
    if (planMode) requestMode("plano");
  });
  pi.on("session_tree", async (_event, ctx) => {
    lastCtx = ctx;
    reconstructTasks(ctx);
    restorePlanState(ctx);
    updatePlanUi(ctx);
  });

  pi.registerCommand("plan", {
    description: "Ativa modo plano: análise sem escrita, plano gravado em .pi/plans/<slug>.md",
    handler: async (args, ctx) => {
      const objective = args?.trim() || "a tarefa solicitada";
      lastCtx = ctx;
      // Sem objetivo e já em modo plano, enablePlan preserva o plano aberto.
      enablePlan(ctx, args?.trim());
      requestMode("plano");
      const exists = planFilePath && existsSync(planFilePath);
      const base =
        `Escreva/atualize o plano no arquivo ${planFileRel} (é o ÚNICO arquivo que você pode gravar agora). ` +
        `Estruture com um objetivo curto, passos NUMERADOS (1., 2., ...), riscos e comandos de validação. ` +
        `Não edite mais nenhum arquivo. Quando o plano estiver pronto, chame a ferramenta exit_plan para apresentá-lo ao usuário e pedir aprovação.`;
      const msg = exists
        ? `Modo plano ativo. Já existe um plano em ${planFileRel} — revise e atualize-o (mantenha os passos numerados). ${base}`
        : `Modo plano ativo. Analise o projeto e crie um plano para: ${objective}\n\n${base}`;
      pi.sendUserMessage(msg, { deliverAs: "followUp" });
    },
  });

  pi.registerCommand("implement", {
    description: "Aprova o plano atual: libera escrita e semeia tarefas",
    handler: async (args, ctx) => {
      const count = approve(ctx);
      persistPlanState(ctx);
      sendImplementPrompt(count, args);
    },
  });

  pi.registerCommand("tasks", {
    description: "Mostra tarefas da sessão atual",
    handler: async (_args, ctx) => {
      ctx.ui.notify(renderTasks(tasks), "info");
    },
  });

  pi.registerCommand("open-plan", {
    description: "Reabre um plano salvo em .pi/plans/<slug>.md para revisão/implementação",
    handler: async (args, ctx) => {
      openPlan(ctx, args?.trim());
    },
  });

  pi.registerCommand("plans", {
    description: "Lista os planos salvos em .pi/plans/ (e abre um, se houver UI)",
    handler: async (_args, ctx) => {
      const dir = resolve(ctx.cwd, ".pi", "plans");
      if (!existsSync(dir)) {
        ctx.ui.notify("Nenhum plano salvo ainda (.pi/plans/ inexistente).", "info");
        return;
      }
      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs);
      if (files.length === 0) {
        ctx.ui.notify("Nenhum plano salvo ainda.", "info");
        return;
      }
      if (ctx.hasUI) {
        const choice = await ctx.ui.select(
          "Planos salvos — qual reabrir?",
          [...files.map((f) => f.replace(/\.md$/, "")), "Cancelar"],
        );
        if (choice && choice !== "Cancelar") openPlan(ctx, choice);
        return;
      }
      ctx.ui.notify(files.map((f) => "- " + f.replace(/\.md$/, "")).join("\n"), "info");
    },
  });

  // Sem atalho próprio: o modo plano entrou no ciclo do Shift+Tab (permissions.ts). O
  // ctrl+shift+p anterior nem funcionava em terminal sem protocolo Kitty — o Termux legado
  // manda o mesmo byte de ctrl+p, que é o ciclo de modelos do Pi.

  pi.on("before_agent_start", async () => {
    if (!planMode) return undefined;
    return {
      message: {
        customType: "plan-mode-context",
        content:
          `[MODO PLANO ATIVO]\n` +
          `O usuário quer um plano antes de qualquer execução. Você NÃO DEVE fazer edições, ` +
          `rodar comandos que alterem o sistema (incluindo mudar configurações, instalar pacotes, ` +
          `criar commits) nem realizar qualquer outra mudança até o plano ser aprovado.\n` +
          `- A ÚNICA escrita permitida é o arquivo de plano: ${planFileRel}. Toda outra escrita é bloqueada.\n` +
          `- Bash é permitido, mas apenas para investigar: leitura, busca, git status/diff/log. ` +
          `Não use bash para contornar o bloqueio de escrita.\n` +
          `- subagent apenas em mode=explore.\n` +
          `- Escreva no arquivo de plano: objetivo, passos NUMERADOS, riscos e comandos de validação.\n` +
          `- Quando o plano estiver pronto, chame a ferramenta exit_plan para pedir aprovação.`,
        display: false,
      },
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!planMode) return undefined;

    if (event.toolName === "write" || event.toolName === "edit") {
      const p = String((event.input as any).path ?? "");
      const abs = isAbsolute(p) ? resolve(p) : resolve(ctx.cwd, p);
      // Libera qualquer arquivo DENTRO de .pi/plans/ (robusto a nome escolhido pelo agente
      // e seguro contra traversal), não só o caminho exato calculado no /plan.
      if (isInsidePlans(ctx, abs)) return undefined;
      return {
        block: true,
        reason: `Modo plano ativo: escrita bloqueada — só é permitido gravar dentro de .pi/plans/ (ex.: ${planFileRel}). Chame exit_plan quando o plano estiver pronto.`,
      };
    }

    if (event.toolName === "subagent") {
      // Só o tipo `explore` é comprovadamente somente-leitura. Os tipos de agents/*.md
      // trazem as próprias ferramentas, e esta extensão não tem como inspecioná-las (o
      // loader dá um jiti por extensão), então em modo plano vale a lista conservadora.
      const input = event.input as any;
      const tipo = String(input.subagent_type ?? input.mode ?? "explore");
      if (tipo !== "explore") {
        return {
          block: true,
          reason: `Modo plano ativo: subagent_type="${tipo}" bloqueado (pode editar). Use subagent_type="explore".`,
        };
      }
    }

    return undefined;
  });

  // Equivalente ao ExitPlanMode do Claude Code: o agente chama quando o plano está pronto;
  // apresenta um gate de aprovação (Aprovar / Editar / Rejeitar) e só então libera a escrita.
  pi.registerTool({
    name: "exit_plan",
    label: "Exit Plan",
    description:
      "Apresenta o plano escrito ao usuário e pede aprovação. Chame quando o plano no arquivo estiver completo. Bloqueia até o usuário decidir. Só use em modo plano.",
    promptSnippet: "Apresenta o plano ao usuário para aprovar, editar ou rejeitar; libera a escrita ao aprovar.",
    promptGuidelines: [
      "Chame exit_plan somente depois de escrever o plano completo (objetivo, passos numerados, riscos, validações) no arquivo de plano.",
      "Se o usuário rejeitar, refine o plano conforme o feedback retornado e chame exit_plan de novo.",
    ],
    parameters: Type.Object({}),
    // Dialogs (ctx.ui.select/input) dentro de execute exigem execução sequencial: em modo
    // paralelo (default do Pi), outro dialog concorrente (safety-guard, exit_plan duplicado)
    // sobrescreve o slot único da TUI e a Promise do primeiro nunca resolve — o turno trava.
    executionMode: "sequential",
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      if (!planMode) {
        return { content: [{ type: "text", text: "Não está em modo plano; nada a aprovar." }], details: undefined };
      }
      const plan = readPlan().trim();
      if (!plan) {
        return {
          content: [{ type: "text", text: `O arquivo de plano ${planFileRel} está vazio ou não existe. Escreva o plano nele antes de chamar exit_plan.` }],
          details: undefined,
        };
      }
      if (!ctx.hasUI) {
        const n = approve(ctx);
        persistPlanState(ctx);
        sendImplementPrompt(n);
        return { content: [{ type: "text", text: `Sem UI para confirmar: plano aprovado automaticamente. ${n} tarefa(s) criadas. Escrita liberada.` }], details: undefined };
      }

      while (true) {
        const choice = await planGate(ctx, readPlan().trim(), planFileRel);

        if (choice === "approve-auto" || choice === "approve-manual") {
          const nextMode = choice === "approve-auto" ? "aceitar-edicoes" : "perguntar";
          const n = approve(ctx, nextMode);
          persistPlanState(ctx);
          sendImplementPrompt(n);
          return {
            content: [
              {
                type: "text",
                text: `Plano aprovado pelo usuário; escrita liberada em modo "${nextMode}", ${n} tarefa(s) criadas.`,
              },
            ],
            details: { nextMode },
          };
        }

        if (choice === "edit") {
          const edited = await ctx.ui.editor("Editar plano", readPlan());
          if (edited !== undefined) {
            writePlan(edited);
            persistPlanState(ctx);
            ctx.ui.notify("Plano atualizado.", "info");
          }
          continue; // reapresenta o gate
        }

        // Rejeitar (ou cancelado): coleta feedback e devolve o controle ao agente, ainda em modo plano.
        const feedback = (await ctx.ui.input("O que ajustar no plano? (enter para pular)", "")) ?? "";
        const msg = feedback.trim()
          ? `Usuário quer continuar no modo plano. Ajuste o plano em ${planFileRel} conforme o feedback: ${feedback.trim()}. Depois chame exit_plan de novo.`
          : `Usuário quer continuar no modo plano. Refine o plano em ${planFileRel} e chame exit_plan de novo quando pronto.`;
        return { content: [{ type: "text", text: msg }], details: undefined };
      }
    },
  });

  pi.registerTool({
    name: "task_list",
    label: "Task List",
    description:
      "Mantém a lista de tarefas da sessão. Envie SEMPRE a lista inteira, com o estado de cada tarefa " +
      "(pending, in_progress, completed) — a lista enviada substitui a anterior.",
    promptSnippet: "Acompanha o progresso de tarefas com múltiplos passos, visível para o usuário.",
    promptGuidelines: [
      "Use task_list em tarefas de vários passos, e envie a lista completa a cada atualização.",
      "Exatamente uma tarefa em in_progress por vez. Marque completed assim que terminar cada uma — nunca acumule para marcar tudo no fim.",
      "content é o imperativo ('Migrar o checkpoint'); activeForm é o gerúndio mostrado enquanto ela roda ('Migrando o checkpoint').",
    ],
    parameters: Type.Object({
      todos: Type.Array(
        Type.Object({
          content: Type.String({ description: "A tarefa, no imperativo" }),
          activeForm: Type.String({ description: "A mesma tarefa no gerúndio, exibida enquanto está em andamento" }),
          status: Type.String({ description: "pending, in_progress ou completed" }),
        }),
        { description: "A lista INTEIRA de tarefas; substitui a anterior" },
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { tasks: next, error } = normalizeTasks(params.todos);
      if (error) {
        return {
          content: [{ type: "text", text: `Erro: ${error}` }],
          isError: true,
          details: { tasks: cloneTasks(tasks), error } satisfies TaskDetails,
        };
      }

      tasks = next;
      updatePlanUi(ctx);
      return {
        content: [{ type: "text", text: renderTasks(tasks) }],
        details: { tasks: cloneTasks(tasks) } satisfies TaskDetails,
      };
    },
  });
}
